import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
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
import {
  MtnPaymentService,
  TransactionType,
} from '../../../../transaction-process/providers';
import {
  MTN_REQUEST_TO_PAY_ERROR_MAPPINGS,
  MTNPaymentStatus,
  MTNRequestToPayErrorReason,
  WebhookEvent,
} from '../../../../../types/mtn';
import {
  EnhancedError,
  ErrorCategory,
} from '../../../../../../utils/errorHandler';

// Register redaction filter for masking sensitive data in logs
registerRedactFilter();

// Register additional sensitive fields for redaction
const sensitiveFields = [
  'mobileNo',
  'merchantMobileNo',
  'customerPhone',
  'partyId',
  'payeePartyId',
  'payerPartyId',
];
registerRedactFilter(sensitiveFields);

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

export class MTNPaymentWebhookService {
  private readonly logger: Logger;

  private readonly mtnService: MtnPaymentService;

  private readonly dbService: DynamoDBService;

  private readonly snsService: SNSService;

  private readonly instantDisbursementEnabled: boolean;

  private readonly payqamFeePercentage: number;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.mtnService = new MtnPaymentService();
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.instantDisbursementEnabled =
      process.env.INSTANT_DISBURSEMENT_ENABLED === 'true';
    this.payqamFeePercentage = parseFloat(
      process.env.PAYQAM_FEE_PERCENTAGE || '2.5'
    );
    this.logger.info('MTNPaymentWebhookService initialized', {
      instantDisbursementEnabled: this.instantDisbursementEnabled,
      payqamFeePercentage: this.payqamFeePercentage,
    });
  }

  /**
   * Handles successful payment processing
   * @throws WebhookError if processing fails
   */
  private async handleSuccessfulPayment(
    transactionId: string,
    webhookEvent: WebhookEvent
  ): Promise<Record<string, unknown>> {
    this.logger.info('Processing successful merchant refund', {
      transactionId,
      externalId: webhookEvent.externalId,
      amount: webhookEvent.amount,
      currency: webhookEvent.currency,
      status: webhookEvent.status,
    });

    try {
      // Get existing transaction to retrieve current merchantRefundResponse array
      this.logger.debug('Retrieving transaction details from DynamoDB', {
        transactionId,
      });

      const existingTransaction = await this.dbService.getItem({
        transactionId,
      });

      if (!existingTransaction.Item) {
        this.logger.error('Transaction not found in database', {
          transactionId,
        });
        throw new WebhookError(`Transaction not found: ${transactionId}`, 404);
      }

      this.logger.debug('Retrieved transaction details', {
        transactionId,
        hasExistingResponses:
          !!existingTransaction.Item?.merchantRefundResponse,
        merchantId: existingTransaction.Item?.merchantId,
        merchantMobileNo: existingTransaction.Item?.merchantMobileNo
          ? maskMobileNumber(existingTransaction.Item.merchantMobileNo)
          : undefined,
        customerPhone: existingTransaction.Item?.customerPhone
          ? maskMobileNumber(existingTransaction.Item.customerPhone)
          : undefined,
      });

      const existingResponses =
        existingTransaction?.Item?.merchantRefundResponse || [];
      const totalMerchantRefundAmount =
        Number(existingTransaction.Item?.totalMerchantRefundAmount) || 0;
      // Ensure existingResponses is treated as an array
      const responseArray = Array.isArray(existingResponses)
        ? existingResponses
        : [];
      const dateTime = new Date().toISOString();

      this.logger.debug('Preparing update data for transaction', {
        currentTotalRefundAmount: totalMerchantRefundAmount,
        newRefundAmount: webhookEvent.amount,
        updatedTotalRefundAmount:
          Number(totalMerchantRefundAmount) + Number(webhookEvent.amount),
        existingResponsesCount: responseArray.length,
      });

      const updateData: Record<string, unknown> = {
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
        totalMerchantRefundAmount:
          Number(totalMerchantRefundAmount) + Number(webhookEvent.amount),
        merchantRefundResponse: [
          ...responseArray,
          { ...webhookEvent, createdOn: dateTime },
        ],
      };

      this.logger.info('Prepared update data for transaction', {
        transactionId,
        status: updateData.status,
        totalMerchantRefundAmount: updateData.totalMerchantRefundAmount,
      });

      // Send to SalesForce
      this.logger.debug('Publishing transaction update to SNS', {
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
      });

      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
        type: 'CREATE',
        createdOn: dateTime,
      });

      this.logger.debug('Publishing detailed transaction data to SNS', {
        transactionId: webhookEvent.externalId,
        paymentMethod: 'MTN MOMO',
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
        amount: webhookEvent.amount,
        transactionType: 'REFUND',
      });

      await this.snsService.publish({
        transactionId: webhookEvent.externalId,
        paymentMethod: 'MTN MOMO',
        status: String(MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL),
        type: 'CREATE',
        amount: webhookEvent.amount,
        merchantId: existingTransaction.Item?.merchantId,
        merchantMobileNo: existingTransaction.Item?.merchantMobileNo,
        transactionType: 'REFUND',
        createdOn: dateTime,
        customerPhone: existingTransaction.Item?.customerPhone,
        currency: existingTransaction.Item?.merchantId,
        originalTransactionId: existingTransaction.Item?.transactionId,
      });

      this.logger.info('Successfully published to SNS', {
        transactionId,
        externalId: webhookEvent.externalId,
      });

      return updateData;
    } catch (error) {
      this.logger.error('Failed to handle successful payment', {
        transactionId,
        externalId: webhookEvent.externalId,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
      });

      throw new WebhookError('Failed to handle the successful payment', 500, {
        originalError: error,
      });
    }
  }

  /**
   * Handles failed payment processing
   * @throws WebhookError if processing fails
   */
  private async handleFailedPayment(
    transactionId: string,
    transactionStatus: WebhookEvent
  ): Promise<Record<string, unknown>> {
    this.logger.info('Processing failed merchant refund', {
      transactionId,
      externalId: transactionStatus.externalId,
      amount: transactionStatus.amount,
      currency: transactionStatus.currency,
      reason: transactionStatus.reason,
    });

    try {
      const errorReason = transactionStatus.reason;
      const errorMapping = MTN_REQUEST_TO_PAY_ERROR_MAPPINGS[
        errorReason as MTNRequestToPayErrorReason
      ] || {
        statusCode: 500,
        message: 'Unknown error',
        label: 'UNKNOWN_ERROR',
        retryable: false,
        suggestedAction: 'Contact support',
      };

      this.logger.debug('Mapped error details', {
        errorReason,
        errorCode: errorMapping.statusCode,
        errorMessage: errorMapping.message,
        errorLabel: errorMapping.label,
        retryable: errorMapping.retryable,
        suggestedAction: errorMapping.suggestedAction,
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

      // Get existing transaction to retrieve current merchantRefundResponse array
      this.logger.debug('Retrieving transaction details from DynamoDB', {
        transactionId,
      });

      const existingTransaction = await this.dbService.getItem({
        transactionId,
      });

      if (!existingTransaction.Item) {
        this.logger.error('Transaction not found in database', {
          transactionId,
        });
        throw new WebhookError(`Transaction not found: ${transactionId}`, 404);
      }

      this.logger.debug('Retrieved transaction details', {
        transactionId,
        hasExistingResponses:
          !!existingTransaction.Item?.merchantRefundResponse,
        merchantId: existingTransaction.Item?.merchantId,
        merchantMobileNo: existingTransaction.Item?.merchantMobileNo
          ? maskMobileNumber(existingTransaction.Item.merchantMobileNo)
          : undefined,
        customerPhone: existingTransaction.Item?.customerPhone
          ? maskMobileNumber(existingTransaction.Item.customerPhone)
          : undefined,
      });

      const existingResponses =
        existingTransaction?.Item?.merchantRefundResponse || [];

      // Ensure existingResponses is treated as an array
      const responseArray = Array.isArray(existingResponses)
        ? existingResponses
        : [];

      // Send to SalesForce
      const dateTime = new Date().toISOString();

      this.logger.debug('Publishing transaction update to SNS', {
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
      });

      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
        type: 'CREATE',
      });

      this.logger.debug('Publishing detailed transaction data to SNS', {
        transactionId: transactionStatus.externalId,
        paymentMethod: 'MTN MOMO',
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
        amount: transactionStatus.amount,
        transactionType: 'REFUND',
        errorCode: errorMapping.statusCode,
        errorMessage: errorReason,
        errorType: errorMapping.label,
      });

      await this.snsService.publish({
        transactionId: transactionStatus.externalId,
        paymentMethod: 'MTN MOMO',
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
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

      this.logger.info('Prepared update data for failed transaction', {
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
        errorCategory: enhancedError.category,
        retryable: errorMapping.retryable,
      });

      return {
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
        merchantRefundResponse: [
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
      this.logger.error('Failed to handle failed payment', {
        transactionId,
        externalId: transactionStatus.externalId,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
      });

      throw new WebhookError('Failed to handle the failed payment', 500, {
        originalError: error,
      });
    }
  }

  /**
   * Validates and parses the webhook event
   * @throws WebhookError if validation fails
   */
  private parseWebhookEvent(body: string | null): WebhookEvent {
    this.logger.debug('Parsing webhook event body', {
      hasBody: !!body,
      bodyLength: body?.length,
    });

    if (!body) {
      this.logger.warn('No body provided in webhook');
      throw new WebhookError('No body provided in webhook', 400);
    }

    try {
      const webhookEvent = JSON.parse(body) as WebhookEvent;

      this.logger.debug('Parsed webhook event', {
        externalId: webhookEvent.externalId,
        amount: webhookEvent.amount,
        currency: webhookEvent.currency,
        status: webhookEvent.status,
        hasReason: !!webhookEvent.reason,
      });

      // Validate required fields
      if (
        !webhookEvent.externalId ||
        !webhookEvent.amount ||
        !webhookEvent.currency ||
        !webhookEvent.status
      ) {
        const missingFields = [];
        if (!webhookEvent.externalId) missingFields.push('externalId');
        if (!webhookEvent.amount) missingFields.push('amount');
        if (!webhookEvent.currency) missingFields.push('currency');
        if (!webhookEvent.status) missingFields.push('status');

        this.logger.warn('Missing required fields in webhook event', {
          missingFields,
        });

        throw new WebhookError('Missing required fields in webhook event', 400);
      }

      return webhookEvent;
    } catch (error) {
      if (error instanceof WebhookError) {
        throw error;
      }

      this.logger.error('Failed to parse webhook payload', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        body:
          body?.substring(0, 100) + (body && body.length > 100 ? '...' : ''),
      });

      throw new WebhookError('Invalid webhook payload', 400);
    }
  }

  /**
   * Processes the MTN merchant refund webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    this.logger.info('Processing merchant refund webhook', {
      path: event.path,
      httpMethod: event.httpMethod,
      hasBody: !!event.body,
      headers: Object.keys(event.headers || {}),
    });

    try {
      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId } = webhookEvent;

      this.logger.debug('Looking up transaction reference', {
        externalId,
      });

      // Get temporary reference item from DB
      const result = await this.dbService.getItem<{
        transactionId: string;
      }>({
        transactionId: externalId,
      });

      if (!result.Item) {
        this.logger.warn('Transaction reference not found', {
          externalId,
        });
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      this.logger.debug('Found transaction reference', {
        externalId,
        originalTransactionId: result.Item.originalTransactionId,
      });

      const transactionItem = await this.dbService.getItem<{
        transactionId: string;
      }>({
        transactionId: result.Item.originalTransactionId,
      });

      if (!transactionItem.Item) {
        this.logger.warn('Original transaction not found', {
          originalTransactionId: result.Item.originalTransactionId,
        });
        throw new WebhookError(
          `Original transaction not found: ${result.Item.originalTransactionId}`,
          404
        );
      }

      this.logger.debug('Retrieved original transaction', {
        transactionId: transactionItem.Item.transactionId,
      });

      const transaction: Record<string, any> = transactionItem.Item as Record<
        string,
        any
      >;

      this.logger.debug('Checking transaction status with MTN', {
        externalId,
        transactionType: TransactionType.MERCHANT_REFUND,
      });

      const transactionStatus: WebhookEvent =
        await this.mtnService.checkTransactionStatus(
          externalId,
          TransactionType.MERCHANT_REFUND
        );

      this.logger.info('Retrieved transaction status from MTN', {
        externalId,
        status: transactionStatus.status,
        reason: transactionStatus.reason,
      });

      const updateData: Record<string, unknown> =
        transactionStatus.status === 'SUCCESSFUL'
          ? await this.handleSuccessfulPayment(
              transaction?.transactionId,
              webhookEvent
            )
          : await this.handleFailedPayment(
              transaction?.transactionId,
              transactionStatus
            );

      this.logger.debug('Updating transaction record in DynamoDB', {
        transactionId: transaction?.transactionId,
        status: updateData.status,
      });

      // Update the payment record in DB
      await this.dbService.updatePaymentRecord(
        { transactionId: transaction?.transactionId },
        updateData
      );

      this.logger.debug('Deleting temporary reference record', {
        externalId,
      });

      // delete the previous temp item
      await this.dbService.deletePaymentRecord({ transactionId: externalId });

      this.logger.info('Webhook processed successfully', {
        externalId,
        status: updateData.status,
        uniqueId: updateData.uniqueId,
        settlementStatus: updateData.settlementStatus,
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
        error: webhookError,
        details: webhookError.details,
        message: webhookError.message,
        statusCode: webhookError.statusCode,
        stack: webhookError instanceof Error ? webhookError.stack : undefined,
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
  const service = new MTNPaymentWebhookService();
  return service.processWebhook(event);
};
