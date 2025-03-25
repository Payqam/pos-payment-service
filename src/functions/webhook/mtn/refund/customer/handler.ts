import {
  APIGatewayProxyHandler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  registerRedactFilter,
  maskMobileNumber,
} from '../../../../../../utils/redactUtil';
import { DynamoDBService } from '../../../../../services/dynamodbService';
import { SNSService } from '../../../../../services/snsService';

// Register redaction filter for masking sensitive data in logs
registerRedactFilter();

import {
  MtnPaymentService,
  TransactionType,
} from '../../../../transaction-process/providers';
import {
  MTN_TRANSFER_ERROR_MAPPINGS,
  MTNPaymentStatus,
  MTNTransferErrorReason,
  WebhookEvent,
} from '../../../../../types/mtn';
import {
  EnhancedError,
  ErrorCategory,
} from '../../../../../../utils/errorHandler';
import { v4 as uuidv4 } from 'uuid';

class WebhookError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

export class MTNDisbursementWebhookService {
  private readonly logger: Logger;

  private readonly dbService: DynamoDBService;

  private readonly snsService: SNSService;

  private readonly mtnService: MtnPaymentService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.mtnService = new MtnPaymentService();
    this.logger.info('init()');
  }

  /**
   * Handles failed payment processing
   * @throws WebhookError if processing fails
   */
  private async handleFailedTransfer(
    transactionId: string,
    transactionStatus: WebhookEvent
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.debug('Processing failed customer refund webhook', {
        transactionId,
        externalId: transactionStatus.externalId,
        status: transactionStatus.status,
        reason: transactionStatus.reason,
        amount: transactionStatus.amount,
        currency: transactionStatus.currency,
        financialTransactionId: transactionStatus.financialTransactionId,
      });

      const errorReason = transactionStatus.reason;
      const errorMapping =
        MTN_TRANSFER_ERROR_MAPPINGS[errorReason as MTNTransferErrorReason];

      this.logger.debug('Mapped error details for failed customer refund', {
        transactionId,
        errorReason,
        errorMapping: {
          statusCode: errorMapping.statusCode,
          label: errorMapping.label,
          message: errorMapping.message,
          retryable: errorMapping.retryable,
        },
      });

      // Create enhanced error for logging and tracking
      const enhancedError = new EnhancedError(
        errorMapping.statusCode as unknown as string,
        ErrorCategory.PROVIDER_ERROR,
        errorMapping.message,
        {
          retryable: errorMapping.retryable,
          suggestedAction: errorMapping.suggestedAction,
          httpStatus: errorMapping.statusCode,
          originalError: transactionStatus.reason,
        }
      );

      this.logger.debug('Created enhanced error for failed customer refund', {
        transactionId,
        errorCategory: enhancedError.category,
        errorMessage: enhancedError.message,
        retryable: errorMapping.retryable,
      });

      // Get existing transaction to retrieve current customerRefundResponse array
      this.logger.debug(
        'Retrieving existing transaction for customer refund update',
        {
          transactionId,
        }
      );

      const existingTransaction = await this.dbService.getItem({
        transactionId,
      });

      if (!existingTransaction?.Item) {
        this.logger.error('Transaction not found for customer refund update', {
          transactionId,
        });
        throw new WebhookError(
          'Transaction not found for customer refund update',
          404,
          {
            transactionId,
          }
        );
      }

      this.logger.debug('Retrieved existing transaction for customer refund', {
        transactionId,
        merchantId: existingTransaction.Item?.merchantId,
        merchantMobileNo: existingTransaction.Item?.merchantMobileNo
          ? maskMobileNumber(existingTransaction.Item.merchantMobileNo)
          : undefined,
        customerPhone: existingTransaction.Item?.mobileNo
          ? maskMobileNumber(existingTransaction.Item.mobileNo)
          : undefined,
        currentStatus: existingTransaction.Item?.status,
      });

      const existingResponses =
        existingTransaction?.Item?.customerRefundResponse || [];

      // Ensure existingResponses is treated as an array
      const responseArray = Array.isArray(existingResponses)
        ? existingResponses
        : [];

      this.logger.debug('Existing customer refund responses', {
        transactionId,
        responseCount: responseArray.length,
      });

      // Send to SalesForce
      const dateTime = new Date().toISOString();

      this.logger.debug('Publishing customer refund failure notification', {
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_FAILED,
        type: 'CREATE',
      });

      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_FAILED,
        type: 'CREATE',
      });

      this.logger.debug(
        'Publishing detailed customer refund failure notification',
        {
          transactionId: transactionStatus.externalId,
          paymentMethod: 'MTN MOMO',
          status: MTNPaymentStatus.CUSTOMER_REFUND_FAILED,
          type: 'CREATE',
          amount: transactionStatus.amount,
          errorCode: errorMapping.statusCode,
          errorType: errorMapping.label,
        }
      );

      await this.snsService.publish({
        transactionId: transactionStatus.externalId,
        paymentMethod: 'MTN MOMO',
        status: MTNPaymentStatus.CUSTOMER_REFUND_FAILED,
        type: 'CREATE',
        amount: transactionStatus.amount,
        merchantId: existingTransaction.Item?.merchantId,
        merchantMobileNo: existingTransaction.Item?.merchantMobileNo,
        transactionType: 'REFUND',
        createdOn: dateTime,
        customerPhone: existingTransaction.Item?.mobileNo,
        currency: existingTransaction.Item?.currency,
        TransactionError: {
          ErrorCode: errorMapping.statusCode,
          ErrorMessage: errorReason,
          ErrorType: errorMapping.label,
          ErrorSource: 'pos',
        },
      });

      this.logger.debug(
        'Successfully published customer refund failure notifications',
        {
          transactionId,
        }
      );

      const updateData = {
        status: MTNPaymentStatus.CUSTOMER_REFUND_FAILED,
        customerRefundResponse: [
          ...responseArray,
          {
            ...transactionStatus,
            createdOn: dateTime,
            errorMessage: enhancedError.message,
            reason: transactionStatus.reason as string,
            retryable: errorMapping.retryable,
            suggestedAction: errorMapping.suggestedAction,
            httpStatus: errorMapping.statusCode,
            errorCategory: enhancedError.category,
          },
        ],
      };

      this.logger.info('Customer refund failed, prepared update data', {
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_FAILED,
        totalResponses: updateData.customerRefundResponse.length,
      });

      return updateData;
    } catch (error) {
      this.logger.error('Failed to handle the failed customer refund', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        transactionId,
        externalId: transactionStatus.externalId,
      });
      throw new Error('Failed to handle the failed customer refund');
    }
  }

  /**
   * Handles successful transfer processing
   * @throws WebhookError if processing fails
   */
  private async handleSuccessfulTransfer(
    transactionId: string,
    transactionStatus: WebhookEvent
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.debug('Processing successful customer refund webhook', {
        transactionId,
        externalId: transactionStatus.externalId,
        status: transactionStatus.status,
        amount: transactionStatus.amount,
        currency: transactionStatus.currency,
        financialTransactionId: transactionStatus.financialTransactionId,
      });

      // Send to SalesForce
      this.logger.debug('Publishing customer refund success notification', {
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL,
        type: 'CREATE',
      });

      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL,
        type: 'CREATE',
      });

      this.logger.debug('Successfully published initial success notification', {
        transactionId,
      });

      // Get existing transaction to retrieve current customerRefundResponse array
      this.logger.debug(
        'Retrieving existing transaction for customer refund update',
        {
          transactionId,
        }
      );

      const existingTransaction = await this.dbService.getItem({
        transactionId,
      });

      if (!existingTransaction?.Item) {
        this.logger.error('Transaction not found for customer refund update', {
          transactionId,
        });
        throw new WebhookError(
          'Transaction not found for customer refund update',
          404,
          {
            transactionId,
          }
        );
      }

      this.logger.debug('Retrieved existing transaction for customer refund', {
        transactionId,
        merchantId: existingTransaction.Item?.merchantId,
        merchantMobileNo: existingTransaction.Item?.merchantMobileNo
          ? maskMobileNumber(existingTransaction.Item.merchantMobileNo)
          : undefined,
        customerPhone: existingTransaction.Item?.mobileNo
          ? maskMobileNumber(existingTransaction.Item.mobileNo)
          : undefined,
        currentStatus: existingTransaction.Item?.status,
      });

      const dateTime = new Date().toISOString();

      this.logger.debug(
        'Publishing detailed customer refund success notification',
        {
          transactionId: transactionStatus.externalId,
          paymentMethod: 'MTN MOMO',
          status: String(MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL),
          type: 'CREATE',
          amount: transactionStatus.amount,
        }
      );

      await this.snsService.publish({
        transactionId: transactionStatus.externalId,
        paymentMethod: 'MTN MOMO',
        status: String(MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL),
        type: 'CREATE',
        amount: transactionStatus.amount,
        merchantId: existingTransaction.Item?.merchantId,
        merchantMobileNo: existingTransaction.Item?.merchantMobileNo,
        transactionType: 'REFUND',
        createdOn: dateTime,
        customerPhone: existingTransaction.Item?.customerPhone,
        currency: existingTransaction.Item?.merchantId,
        originalTransactionId: existingTransaction.Item?.transactionId,
      });

      this.logger.debug(
        'Successfully published detailed success notification',
        {
          transactionId,
        }
      );

      const existingResponses =
        existingTransaction?.Item?.customerRefundResponse || [];

      // Ensure existingResponses is treated as an array
      const responseArray = Array.isArray(existingResponses)
        ? existingResponses
        : [];

      this.logger.debug('Existing customer refund responses', {
        transactionId,
        responseCount: responseArray.length,
      });

      const totalCustomerRefundAmount =
        existingTransaction.Item?.totalCustomerRefundAmount || 0;

      const newTotalAmount =
        Number(totalCustomerRefundAmount) + Number(transactionStatus.amount);

      this.logger.debug('Calculated new total customer refund amount', {
        transactionId,
        previousTotal: totalCustomerRefundAmount,
        currentRefundAmount: transactionStatus.amount,
        newTotal: newTotalAmount,
      });

      const updateData = {
        status: MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL,
        totalCustomerRefundAmount: newTotalAmount,
        customerRefundResponse: [
          ...responseArray,
          { ...transactionStatus, createdOn: dateTime },
        ],
      };

      this.logger.info('Customer refund successful, prepared update data', {
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL,
        totalResponses: updateData.customerRefundResponse.length,
        totalCustomerRefundAmount: updateData.totalCustomerRefundAmount,
      });

      return updateData;
    } catch (error) {
      this.logger.error('Failed to handle the successful customer refund', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        transactionId,
        externalId: transactionStatus.externalId,
      });
      throw new Error('Failed to handle the successful customer refund');
    }
  }

  /**
   * Updates the settlement status in DynamoDB
   * @throws WebhookError if update fails
   */
  private async updateCustomerRefundStatus(
    transactionId: string,
    transactionStatusResponse: WebhookEvent
  ): Promise<void> {
    try {
      this.logger.debug('Updating customer refund status', {
        transactionId,
        externalId: transactionStatusResponse.externalId,
        status: transactionStatusResponse.status,
      });

      const updateData =
        transactionStatusResponse.status === 'SUCCESSFUL'
          ? await this.handleSuccessfulTransfer(
              transactionId,
              transactionStatusResponse
            )
          : await this.handleFailedTransfer(
              transactionId,
              transactionStatusResponse
            );

      this.logger.debug('Updating payment record with refund status', {
        transactionId,
        status: updateData.status,
      });

      await this.dbService.updatePaymentRecord({ transactionId }, updateData);

      this.logger.debug(
        'Successfully updated payment record with refund status',
        {
          transactionId,
          status: updateData.status,
        }
      );
    } catch (error) {
      this.logger.error('Failed to update the customer refund status', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        transactionId,
        externalId: transactionStatusResponse.externalId,
      });
      throw new Error('Failed to update the customer refund status');
    }
  }

  /**
   * Validates and parses the webhook event
   * @throws WebhookError if validation fails
   */
  private parseWebhookEvent(body: string | null): WebhookEvent {
    this.logger.debug('Parsing webhook event body');

    if (!body) {
      this.logger.error('No body provided in webhook');
      throw new WebhookError('No body provided in webhook', 400);
    }

    try {
      const webhookEvent = JSON.parse(body) as WebhookEvent;

      this.logger.debug('Parsed webhook event', {
        externalId: webhookEvent.externalId,
        status: webhookEvent.status,
        amount: webhookEvent.amount,
        currency: webhookEvent.currency,
        financialTransactionId: webhookEvent.financialTransactionId,
      });

      // Validate required fields
      if (
        !webhookEvent.externalId ||
        !webhookEvent.amount ||
        !webhookEvent.currency ||
        !webhookEvent.status
      ) {
        this.logger.error('Missing required fields in webhook event', {
          externalId: webhookEvent.externalId,
          amount: webhookEvent.amount,
          currency: webhookEvent.currency,
          status: webhookEvent.status,
        });
        throw new WebhookError('Missing required fields in webhook event', 400);
      }

      return webhookEvent;
    } catch (error) {
      this.logger.error('Invalid webhook payload', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        body,
      });
      throw new WebhookError('Invalid webhook payload', 400);
    }
  }

  /**
   * Processes the MTN customer refund webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    this.logger.info('Processing MTN customer refund webhook', {
      path: event.path,
      httpMethod: event.httpMethod,
      hasBody: !!event.body,
    });

    try {
      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId } = webhookEvent;

      this.logger.debug('Webhook event parsed successfully', {
        externalId,
        status: webhookEvent.status,
      });

      // Get temporary reference item from DB
      this.logger.debug('Retrieving temporary reference item', {
        externalId,
      });

      const result = await this.dbService.getItem<{
        transactionId: string;
      }>({
        transactionId: externalId,
      });

      if (!result.Item) {
        this.logger.error('Transaction not found', {
          externalId,
        });
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      this.logger.debug('Found temporary reference item', {
        externalId,
        originalTransactionId: result.Item.originalTransactionId,
      });

      this.logger.debug('Retrieving original transaction', {
        originalTransactionId: result.Item.originalTransactionId,
      });

      const transactionItem = await this.dbService.getItem<{
        transactionId: string;
      }>({
        transactionId: result.Item.originalTransactionId,
      });

      if (!transactionItem.Item) {
        this.logger.error('Original transaction not found', {
          originalTransactionId: result.Item.originalTransactionId,
        });
        throw new WebhookError(
          `Original transaction not found: ${result.Item.originalTransactionId}`,
          404
        );
      }

      const transaction: Record<string, any> = transactionItem.Item as Record<
        string,
        any
      >;

      this.logger.debug('Retrieved original transaction', {
        transactionId: transaction.transactionId,
        merchantId: transaction.merchantId,
        merchantMobileNo: transaction.merchantMobileNo
          ? maskMobileNumber(transaction.merchantMobileNo)
          : undefined,
        customerPhone: transaction.mobileNo
          ? maskMobileNumber(transaction.mobileNo)
          : undefined,
        status: transaction.status,
      });

      this.logger.debug('Checking transaction status with MTN', {
        externalId,
        transactionType: TransactionType.TRANSFER,
      });

      const transactionStatus = await this.mtnService.checkTransactionStatus(
        externalId,
        TransactionType.TRANSFER
      );

      this.logger.debug('Received transaction status from MTN', {
        externalId,
        status: transactionStatus.status,
        reason: transactionStatus.reason,
      });

      this.logger.debug('Updating customer refund status', {
        transactionId: transaction.transactionId,
        status: transactionStatus.status,
      });

      await this.updateCustomerRefundStatus(
        transaction.transactionId,
        transactionStatus
      );

      this.logger.debug('Customer refund status updated successfully', {
        transactionId: transaction.transactionId,
        status: transactionStatus.status,
      });

      // Initiate merchant refund if customer refund is successful
      if (transactionStatus.status === 'SUCCESSFUL') {
        const merchantRefundId = uuidv4();

        this.logger.debug(
          'Customer refund successful, initiating merchant refund',
          {
            transactionId: transaction.transactionId,
            merchantRefundId,
            amount: transactionStatus.amount,
          }
        );

        this.logger.debug('Creating axios instance for merchant refund', {
          transactionType: TransactionType.MERCHANT_REFUND,
          merchantRefundId,
        });

        const axiosInstance = await this.mtnService.createAxiosInstance(
          TransactionType.MERCHANT_REFUND,
          merchantRefundId
        );

        this.logger.debug('Sending merchant refund request to MTN', {
          merchantRefundId,
          amount: transactionStatus.amount,
          currency: transaction.currency,
          merchantMobileNo: maskMobileNumber(transaction.merchantMobileNo),
        });

        // Create payment request in MTN
        await axiosInstance.post('/collection/v1_0/requesttopay', {
          amount: transactionStatus.amount.toString(),
          currency: transaction.currency,
          externalId: merchantRefundId,
          payer: {
            partyIdType: 'MSISDN',
            partyId: transaction.merchantMobileNo,
          },
          payerMessage: `PayQAM refund request for the transaction ${transaction.transactionId}`,
          payeeNote: 'Thank you for your payment',
        });

        this.logger.debug('Merchant refund request sent successfully', {
          merchantRefundId,
        });

        // Update the payment record
        const dateTime = new Date().toISOString();

        this.logger.debug(
          'Updating payment record with merchant refund information',
          {
            transactionId: transaction.transactionId,
            status: MTNPaymentStatus.MERCHANT_REFUND_REQUEST_CREATED,
            merchantRefundId,
          }
        );

        await this.dbService.updatePaymentRecord(
          { transactionId: transaction.transactionId },
          {
            status: MTNPaymentStatus.MERCHANT_REFUND_REQUEST_CREATED,
            merchantRefundId,
            updatedOn: dateTime,
          }
        );

        this.logger.debug('Creating temporary record for merchant refund', {
          merchantRefundId,
          originalTransactionId: transaction.transactionId,
        });

        // Create a temporary record to associate the transaction with the merchant refund ID
        await this.dbService.createPaymentRecord({
          transactionId: merchantRefundId,
          originalTransactionId: transaction.transactionId,
        });

        this.logger.debug('Publishing merchant refund notification', {
          transactionId: transaction.transactionId,
          status: MTNPaymentStatus.MERCHANT_REFUND_REQUEST_CREATED,
        });

        // Send to SalesForce
        await this.snsService.publish({
          transactionId: transaction.transactionId,
          status: MTNPaymentStatus.MERCHANT_REFUND_REQUEST_CREATED,
          type: 'CREATE',
          createdOn: dateTime,
        });

        // Call merchant refund webhook if in sandbox environment
        const environment = process.env.MTN_TARGET_ENVIRONMENT;
        const webhookUrl = process.env.MTN_MERCHANT_REFUND_WEBHOOK_URL;

        if (environment === 'sandbox' && webhookUrl) {
          this.logger.debug(
            'Sandbox environment detected, calling merchant refund webhook',
            {
              environment,
              webhookUrl,
              merchantRefundId,
            }
          );

          await this.mtnService.callWebhook(
            {
              financialTransactionId: uuidv4(),
              externalId: merchantRefundId,
              amount: transactionStatus.amount.toString(),
              currency: transaction.currency,
              payer: {
                partyIdType: 'MSISDN',
                partyId: transaction.merchantMobileNo,
              },
              payeeNote: `Refund request for the transaction ${transaction.transactionId}`,
              payerMessage: 'Thank you for your payment',
              reason: undefined,
              status: 'SUCCESSFUL',
            },
            TransactionType.MERCHANT_REFUND
          );

          this.logger.debug('Successfully called merchant refund webhook', {
            merchantRefundId,
          });
        }
      }

      // delete the previous temp item
      this.logger.debug('Deleting temporary reference item', {
        externalId,
      });

      await this.dbService.deletePaymentRecord({ transactionId: externalId });

      this.logger.info('Webhook processed successfully', {
        externalId,
        transactionId: transaction.transactionId,
      });

      return {
        statusCode: 200,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ message: 'Webhook processed successfully' }),
      };
    } catch (error) {
      const webhookError =
        error instanceof WebhookError
          ? error
          : new WebhookError('Internal server error', 500, { error });

      this.logger.error('Error processing webhook', {
        error:
          webhookError instanceof Error
            ? {
                name: webhookError.name,
                message: webhookError.message,
                stack: webhookError.stack,
              }
            : String(webhookError),
        statusCode: webhookError.statusCode,
        details: webhookError.details,
      });

      return {
        statusCode: webhookError.statusCode,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({
          message: webhookError.message,
        }),
      };
    }
  }
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const logger = LoggerService.named('MTNCustomerRefundWebhookHandler');
  logger.info('Received MTN customer refund webhook', {
    path: event.path,
    httpMethod: event.httpMethod,
    hasBody: !!event.body,
  });

  const service = new MTNDisbursementWebhookService();
  return service.processWebhook(event);
};
