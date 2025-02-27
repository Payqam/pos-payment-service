import {
  APIGatewayProxyHandler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBService } from '../../../../services/dynamodbService';
import { SNSService } from '../../../../services/snsService';
import {
  MtnPaymentService,
  TransactionType,
} from '../../../transaction-process/providers';
import {
  MTN_TRANSFER_ERROR_MAPPINGS,
  MTNTransferErrorReason,
  WebhookEvent,
} from '../../../../types/mtn';
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
    this.logger.info('[DEBUG] Handling failed transfer', {
      transactionId,
      status: transactionStatus.status,
      reason: transactionStatus.reason,
    });

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

      this.logger.error('[DEBUG] Transfer failed with enhanced error', {
        error: enhancedError,
        transactionId,
      });

      return {
        status: 'FAILED',
        paymentProviderResponse: {
          status: transactionStatus.status,
          errorMessage: enhancedError.message,
          reason: transactionStatus.reason as string,
          retryable: errorMapping.retryable,
          suggestedAction: errorMapping.suggestedAction,
          httpStatus: errorMapping.statusCode,
          errorCategory: enhancedError.category,
        },
      };
    } catch (error) {
      this.logger.error('[DEBUG] Error in handleFailedTransfer', {
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId,
      });
      throw error;
    }
  }

  /**
   * Updates the settlement status in DynamoDB
   * @throws WebhookError if update fails
   */
  private async updateSettlementStatus(
    transactionId: string,
    transactionStatusResponse: WebhookEvent
  ): Promise<void> {
    this.logger.info('[DEBUG] Updating settlement status', {
      transactionId,
      transactionStatusResponse,
    });

    try {
      const updateData =
        transactionStatusResponse.status === 'SUCCESSFUL'
          ? {
              settlementStatus: transactionStatusResponse.status,
              settlementResponse: {
                status: transactionStatusResponse.status,
                financialTransactionId:
                  transactionStatusResponse.financialTransactionId,
                payeeNote: transactionStatusResponse.payeeNote || '',
                payerMessage: transactionStatusResponse.payerMessage || '',
              },
            }
          : await this.handleFailedTransfer(
              transactionId,
              transactionStatusResponse
            );

      await this.dbService.updatePaymentRecord({ transactionId }, updateData);

      this.logger.info('[DEBUG] Settlement status updated successfully', {
        transactionId,
        transactionStatusResponse,
      });
    } catch (error) {
      this.logger.error('[DEBUG] Failed to update settlement status', {
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId,
      });
      throw error;
    }
  }

  /**
   * Publishes settlement status update to SNS
   * @throws WebhookError if publish fails
   */
  private async publishStatusUpdate(
    transactionId: string,
    uniqueId: string, // Disbursement Settlement ID for MTN
    status: string,
    amount: string,
    currency: string
  ): Promise<void> {
    try {
      await this.snsService.publish(process.env.TRANSACTION_STATUS_TOPIC_ARN!, {
        transactionId,
        uniqueId,
        status,
        type: 'SETTLEMENT',
        amount,
        currency,
      });
    } catch (error) {
      throw new WebhookError('Failed to publish status update', 500, {
        error,
        transactionId,
        uniqueId,
      });
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
      this.logger.info('[DEBUG] Parsed disbursement webhook event', {
        webhookEvent,
      });

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
      this.logger.error('[DEBUG] Failed to parse disbursement webhook event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body,
      });
      throw new WebhookError('Invalid webhook payload', 400);
    }
  }

  /**
   * Processes the MTN disbursement webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      this.logger.info('[DEBUG] Received MTN disbursement webhook', {
        body: event.body,
        headers: event.headers,
      });

      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId } = webhookEvent;

      this.logger.info('[DEBUG] Parsed disbursement webhook event', {
        webhookEvent,
        externalId,
      });

      // Query using uniqueId in the GSI3
      const result = await this.dbService.queryByGSI(
        {
          uniqueId: externalId,
        },
        'GSI3'
      );

      if (!result.Items?.[0]) {
        this.logger.error('[DEBUG] Disbursement transaction not found', {
          externalId,
        });
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      const transactionId = result.Items[0].transactionId;

      this.logger.info('[DEBUG] Checking disbursement status with MTN', {
        externalId,
      });

      const transactionStatus = await this.mtnService.checkTransactionStatus(
        externalId,
        TransactionType.TRANSFER
      );

      this.logger.info('[DEBUG] Disbursement status from MTN', {
        externalId,
        transactionStatus,
      });

      await this.updateSettlementStatus(transactionId, transactionStatus);

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
