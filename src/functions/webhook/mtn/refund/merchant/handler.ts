import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  MtnPaymentService,
  TransactionType,
} from '../../../../transaction-process/providers';
import { DynamoDBService } from '../../../../../services/dynamodbService';
import { SNSService } from '../../../../../services/snsService';
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
    this.logger.info('init()');
  }

  /**
   * Calculates the merchant's settlement amount after deducting PayQAM's fee
   */
  private calculateSettlementAmount(amount: number): number {
    const feePercentage = this.payqamFeePercentage / 100;
    const fee = amount * feePercentage;
    return amount - fee;
  }

  /**
   * Handles successful payment processing
   * @throws WebhookError if processing fails
   */
  private async handleSuccessfulPayment(
    transactionId: string,
    webhookEvent: WebhookEvent
  ): Promise<Record<string, unknown>> {
    try {
      // Get existing transaction to retrieve current merchantRefundResponse array
      const existingTransaction = await this.dbService.getItem({
        transactionId,
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
      const updateData: Record<string, unknown> = {
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
        totalMerchantRefundAmount:
          Number(totalMerchantRefundAmount) + Number(webhookEvent.amount),
        merchantRefundResponse: [
          ...responseArray,
          { ...webhookEvent, createdOn: dateTime },
        ],
      };
      this.logger.info('[debug]update data', {
        updateData,
      });
      // Send to SalesForce
      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
        type: 'CREATE',
        createdOn: dateTime,
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

      this.logger.info('[debug]sent to sns', {
        updateData,
      });
      return updateData;
    } catch (error) {
      this.logger.error('Failed to handle the successful payment');
      throw new Error('Failed to handle the successful payment');
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
    try {
      const errorReason = transactionStatus.reason;
      const errorMapping =
        MTN_REQUEST_TO_PAY_ERROR_MAPPINGS[
          errorReason as MTNRequestToPayErrorReason
        ];

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
      const existingTransaction = await this.dbService.getItem({
        transactionId,
      });
      const existingResponses =
        existingTransaction?.Item?.merchantRefundResponse || [];

      // Ensure existingResponses is treated as an array
      const responseArray = Array.isArray(existingResponses)
        ? existingResponses
        : [];

      // Send to SalesForce
      const dateTime = new Date().toISOString();
      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
        type: 'CREATE',
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
      this.logger.error('Failed to handle the failed payment');
      throw new Error('Failed to handle the failed payment');
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
      throw new WebhookError('Invalid webhook payload', 400);
    }
  }

  /**
   * Processes the MTN merchant refund webhook
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

      const transactionStatus: WebhookEvent =
        await this.mtnService.checkTransactionStatus(
          externalId,
          TransactionType.MERCHANT_REFUND
        );
      this.logger.info('[debug]transaction status', transactionStatus);
      this.logger.info('[debug]transaction', transaction);
      this.logger.info('[debug]result', result);
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
      this.logger.info('[debug]update data', {
        updateData,
      });
      // Update the payment record in DB
      await this.dbService.updatePaymentRecord(
        { transactionId: transaction?.transactionId },
        updateData
      );
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
