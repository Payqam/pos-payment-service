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
      const updateData: Record<string, unknown> = {
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
        merchantRefundResponse: webhookEvent,
      };
      this.logger.info('[debug]update data', {
        updateData,
      });
      // Send to SalesForce
      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL,
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
      // Send to SalesForce
      await this.snsService.publish({
        transactionId,
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
        TransactionError: {
          ErrorCode: errorMapping.statusCode,
          ErrorMessage: errorReason,
          ErrorType: errorMapping.label,
          ErrorSource: 'pos',
        },
      });
      this.logger.info('[debug]sent failed to sns', {});
      return {
        status: MTNPaymentStatus.MERCHANT_REFUND_FAILED,
        merchantRefundResponse: {
          ...transactionStatus,
          errorMessage: enhancedError.message,
          reason: transactionStatus.reason as string,
          retryable: errorMapping.retryable,
          suggestedAction: errorMapping.suggestedAction,
          httpStatus: errorMapping.statusCode,
          errorCategory: enhancedError.category,
        },
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

      const result = await this.dbService.queryByGSI(
        {
          merchantRefundId: externalId,
        },
        'GSI5'
      );
      if (!result || result.Items?.length === 0) {
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      const transaction = result?.Items?.[0] ?? null;

      // Verify the transaction hasn't already been processed
      if (
        transaction?.status ===
          String(MTNPaymentStatus.MERCHANT_REFUND_SUCCESSFUL) ||
        transaction?.status === String(MTNPaymentStatus.MERCHANT_REFUND_FAILED)
      ) {
        this.logger.warn('Merchant refund already processed', {
          transactionId: transaction.transactionId,
          currentStatus: transaction.status,
          externalId,
        });
        return {
          statusCode: 200,
          headers: API.DEFAULT_HEADERS,
          body: JSON.stringify({
            message: 'Webhook already processed for this transaction',
          }),
        };
      }

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
      await this.dbService.updatePaymentRecord(
        { transactionId: transaction?.transactionId },
        updateData
      );

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
