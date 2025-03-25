import {
  APIGatewayProxyHandler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBService } from '../../../../../services/dynamodbService';
import { SNSService } from '../../../../../services/snsService';
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
      const errorReason = transactionStatus.reason;
      const errorMapping =
        MTN_TRANSFER_ERROR_MAPPINGS[errorReason as MTNTransferErrorReason];

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
      // Get existing transaction to retrieve current customerRefundResponse array
      const existingTransaction = await this.dbService.getItem({
        transactionId,
      });
      const existingResponses =
        existingTransaction?.Item?.customerRefundResponse || [];

      // Ensure existingResponses is treated as an array
      const responseArray = Array.isArray(existingResponses)
        ? existingResponses
        : [];

      // Send to SalesForce
      const dateTime = new Date().toISOString();
      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_FAILED,
        type: 'CREATE',
      });
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

      return {
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
    } catch (error) {
      this.logger.error('Failed to handle the failed customer refund');
      throw new Error('Failed to handle the failed failed customer refund');
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
      // Send to SalesForce
      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL,
        type: 'CREATE',
      });

      // Get existing transaction to retrieve current customerRefundResponse array
      const existingTransaction = await this.dbService.getItem({
        transactionId,
      });
      const dateTime = new Date().toISOString();
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
      const existingResponses =
        existingTransaction?.Item?.customerRefundResponse || [];

      // Ensure existingResponses is treated as an array
      const responseArray = Array.isArray(existingResponses)
        ? existingResponses
        : [];
      const totalCustomerRefundAmount =
        existingTransaction.Item?.totalCustomerRefundAmount || 0;
      return {
        status: MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL,
        totalCustomerRefundAmount:
          Number(totalCustomerRefundAmount) + Number(transactionStatus.amount),
        customerRefundResponse: [
          ...responseArray,
          { ...transactionStatus, createdOn: dateTime },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to handle the successful customer refund');
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
      await this.dbService.updatePaymentRecord({ transactionId }, updateData);
    } catch (error) {
      this.logger.error('Failed to update the customer refund status');
      throw new Error('Failed to update the customer refund status');
    }
  }

  /**
   * Validates and parses the webhook event
   * @throws WebhookError if validation fails
   */
  private parseWebhookEvent(body: string | null): WebhookEvent {
    if (!body) {
      throw new WebhookError('No body provided in webhook', 400);
    }

    try {
      const webhookEvent = JSON.parse(body) as WebhookEvent;

      // Validate required fields
      if (
        !webhookEvent.externalId ||
        !webhookEvent.amount ||
        !webhookEvent.currency ||
        !webhookEvent.status
      ) {
        throw new WebhookError('Missing required fields in webhook event', 400);
      }

      return webhookEvent;
    } catch (error) {
      this.logger.error('Invalid webhook payload', body);
      throw new WebhookError('Invalid webhook payload', 400);
    }
  }

  /**
   * Processes the MTN customer refund webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId } = webhookEvent;

      // Get temporary reference item from DB
      const result = await this.dbService.getItem<{
        transactionId: string;
      }>({
        transactionId: externalId,
      });

      if (!result.Item) {
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      const transactionItem = await this.dbService.getItem<{
        transactionId: string;
      }>({
        transactionId: result.Item.originalTransactionId,
      });
      const transaction: Record<string, any> = transactionItem.Item as Record<
        string,
        any
      >;

      const transactionStatus = await this.mtnService.checkTransactionStatus(
        externalId,
        TransactionType.TRANSFER
      );

      await this.updateCustomerRefundStatus(
        transaction.transactionId,
        transactionStatus
      );

      // Initiate merchant refund if customer refund is successful
      if (transactionStatus.status === 'SUCCESSFUL') {
        const merchantRefundId = uuidv4();

        const axiosInstance = await this.mtnService.createAxiosInstance(
          TransactionType.MERCHANT_REFUND,
          merchantRefundId
        );

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
        // Update the payment record
        const dateTime = new Date().toISOString();
        await this.dbService.updatePaymentRecord(
          { transactionId: transaction.transactionId },
          {
            status: MTNPaymentStatus.MERCHANT_REFUND_REQUEST_CREATED,
            merchantRefundId,
            updatedOn: dateTime,
          }
        );
        // Create a temporary record to associate the transaction with the merchant refund ID
        await this.dbService.createPaymentRecord({
          transactionId: merchantRefundId,
          originalTransactionId: transaction.transactionId,
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
        }
      }
      // delete the previous temp item
      await this.dbService.deletePaymentRecord({ transactionId: externalId });
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
        error: webhookError,
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
  const service = new MTNDisbursementWebhookService();
  return service.processWebhook(event);
};
