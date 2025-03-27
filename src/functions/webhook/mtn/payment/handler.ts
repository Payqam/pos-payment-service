import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  MtnPaymentService,
  TransactionType,
} from '../../../transaction-process/providers';
import { DynamoDBService } from '../../../../services/dynamodbService';
import { SNSService } from '../../../../services/snsService';
import {
  MTN_REQUEST_TO_PAY_ERROR_MAPPINGS,
  MTNPaymentStatus,
  MTNRequestToPayErrorReason,
  WebhookEvent,
} from '../../../../types/mtn';
import { v4 as uuidv4 } from 'uuid';
import {
  EnhancedError,
  ErrorCategory,
} from '../../../../../utils/errorHandler';

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
    LoggerService.setLevel('debug');
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
   * Processes instant disbursement for a successful payment
   * @throws WebhookError if disbursement processing fails
   */
  private async processInstantDisbursement(
    transactionId: string,
    amount: number,
    currency: string
  ): Promise<string> {
    try {
      this.logger.info('Processing instant disbursement', {
        transactionId,
        amount,
        currency,
      });
      const result = await this.dbService.getItem({
        transactionId,
      });

      if (!result?.Item) {
        throw new WebhookError('Transaction not found for disbursement', 404, {
          transactionId,
        });
      }

      const uniqueId = await this.mtnService.initiateTransfer(
        amount,
        result.Item.merchantMobileNo,
        currency,
        TransactionType.TRANSFER
      );

      if (!uniqueId) {
        throw new WebhookError('Failed to initiate transfer', 500, {
          transactionId,
          amount,
          currency,
        });
      }

      return uniqueId;
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError('Error processing instant disbursement', 500, {
        error,
        transactionId,
        amount,
      });
    }
  }

  /**
   * Handles successful payment processing
   * @throws WebhookError if processing fails
   */
  private async handleSuccessfulPayment(
    externalId: string,
    amount: string,
    currency: string,
    webhookEvent: WebhookEvent
  ): Promise<Record<string, unknown>> {
    try {
      const amountNumber = parseFloat(amount);
      const settlementAmount = this.calculateSettlementAmount(amountNumber);
      const dateTime = new Date().toISOString();
      const updateData: Record<string, unknown> = {
        status: MTNPaymentStatus.PAYMENT_SUCCESSFUL,
        paymentResponse: webhookEvent,
        fee: amountNumber - settlementAmount,
        updatedOn: dateTime,
      };

      await this.snsService.publish({
        transactionId: externalId,
        status: MTNPaymentStatus.PAYMENT_SUCCESSFUL,
        type: 'CREATE',
        createdOn: dateTime,
        partyIdType: webhookEvent.payer?.partyIdType,
        partyId: webhookEvent.payer?.partyId,
        payeeNote: webhookEvent.payeeNote,
        payerMessage: webhookEvent.payerMessage,
      });

      if (this.instantDisbursementEnabled) {
        try {
          updateData.uniqueId = await this.processInstantDisbursement(
            externalId,
            settlementAmount,
            currency
          );
          updateData.status = MTNPaymentStatus.DISBURSEMENT_REQUEST_CREATED;
          updateData.settlementDate = Date.now();
          updateData.settlementAmount = settlementAmount;
          updateData.updatedOn = dateTime;
          await this.snsService.publish({
            transactionId: externalId,
            status: MTNPaymentStatus.DISBURSEMENT_REQUEST_CREATED,
            type: 'CREATE',
            createdOn: dateTime,
          });
        } catch (error: unknown) {
          this.logger.error('Failed to process instant disbursement', {
            error,
          });
          await this.snsService.publish({
            transactionId: externalId,
            status: MTNPaymentStatus.DISBURSEMENT_FAILED,
            type: 'CREATE',
            TransactionError: {
              ErrorCode: 'errorCode',
              ErrorMessage: 'errorReason',
              ErrorType: 'errorType',
              ErrorSource: 'pos',
            },
          });
        }
      }

      return updateData;
    } catch (error) {
      this.logger.error('Failed to handle the successful payment', {
        error: error instanceof Error ? error.message : 'Unknown error',
        externalId,
        amount,
        currency,
      });
      throw new EnhancedError(
        'SUCCESSFUL_PAYMENT_HANDLING_FAILED',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to handle the successful payment',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check logs for detailed error information',
          transactionId: externalId,
        }
      );
    }
  }

  /**
   * Handles failed payment processing
   * @throws WebhookError if processing fails
   */
  private async handleFailedPayment(
    externalId: string,
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
      await this.snsService.publish({
        transactionId: externalId,
        status: MTNPaymentStatus.PAYMENT_FAILED,
        type: 'CREATE',
        TransactionError: {
          ErrorCode: errorMapping.statusCode,
          ErrorMessage: errorReason,
          ErrorType: errorMapping.label,
          ErrorSource: 'pos',
        },
      });

      return {
        status: MTNPaymentStatus.PAYMENT_FAILED,
        paymentResponse: {
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
      this.logger.error('Failed to handle the failed payment', {
        error: error instanceof Error ? error.message : 'Unknown error',
        externalId,
        errorReason: transactionStatus.reason,
      });
      throw new EnhancedError(
        'FAILED_PAYMENT_HANDLING_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to handle the failed payment',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check logs for detailed error information',
          transactionId: externalId,
        }
      );
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
   * Processes the MTN payment webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId, amount, currency } = webhookEvent;

      const result = await this.dbService.getItem({
        transactionId: externalId,
      });
      if (!result) {
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      const transactionStatus: WebhookEvent =
        await this.mtnService.checkTransactionStatus(
          externalId,
          TransactionType.PAYMENT
        );

      const updateData: Record<string, unknown> =
        transactionStatus.status === 'SUCCESSFUL'
          ? await this.handleSuccessfulPayment(
              externalId,
              amount,
              currency,
              webhookEvent
            )
          : await this.handleFailedPayment(externalId, transactionStatus);

      await this.dbService.updatePaymentRecord(
        { transactionId: externalId },
        updateData
      );
      // Call sandbox disbursement webhook if in sandbox environment
      const environment = process.env.MTN_TARGET_ENVIRONMENT;
      const webhookUrl = process.env.MTN_DISBURSEMENT_WEBHOOK_URL;

      if (
        environment === 'sandbox' &&
        webhookUrl &&
        updateData.uniqueId &&
        updateData.settlementAmount
      ) {
        await this.mtnService.callWebhook(
          {
            financialTransactionId: uuidv4(),
            externalId: updateData.uniqueId as string,
            amount: webhookEvent.amount,
            currency: webhookEvent.currency,
            payee: {
              partyIdType: 'MSISDN',
              partyId: result.Item?.merchantMobileNo,
            },
            payeeNote: 'PayQAM payment request',
            payerMessage: 'Thank you for your payment',
            reason: undefined,
            status: 'SUCCESSFUL',
          },
          TransactionType.TRANSFER
        );
      }

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
