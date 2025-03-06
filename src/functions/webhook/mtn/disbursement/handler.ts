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
    try {
      this.logger.info('Processing failed transfer', { transactionStatus });
      const errorReason = transactionStatus.reason;
      const errorMapping =
        MTN_TRANSFER_ERROR_MAPPINGS[errorReason as MTNTransferErrorReason];
      if (
        errorReason === 'INTERNAL_PROCESSING_ERROR' ||
        errorReason === 'SERVICE_UNAVAILABLE'
      ) {
        const transactionDetails = await this.dbService.getItem<{
          transactionId: string;
        }>({
          transactionId,
        });
        const settlementResponse = transactionDetails?.Item;
        this.logger.info('Transaction details', { transactionDetails });
        if (
          !settlementResponse?.settlementRetryResponse ||
          (settlementResponse?.settlementRetryResponse &&
            settlementResponse.settlementRetryResponse.retryCount <= 3)
        ) {
          const maxRetries = 3;
          let retryCount = 0;

          while (retryCount < maxRetries) {
            try {
              this.logger.info(
                `Retry attempt ${retryCount + 1} for transaction`,
                {
                  transactionId,
                }
              );

              const newTransactionId = await this.mtnService.initiateTransfer(
                parseFloat(transactionStatus.amount),
                transactionStatus.payee.partyId,
                transactionStatus.currency
              );

              this.logger.info(`Retry successful with new transactionId`, {
                newTransactionId,
              });

              return {
                settlementStatus: 'RETRYING',
                uniqueId: newTransactionId,
                settlementRetryResponse: {
                  retryCount: retryCount + 1,
                  newTransactionId,
                  reason: errorReason,
                },
              };
            } catch (retryError) {
              this.logger.error(`Retry ${retryCount + 1} failed`, {
                retryError,
              });
              retryCount++;
            }
          }
        }
      }
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

      return {
        settlementStatus: 'FAILED',
        settlementResponse: {
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
      this.logger.error('Failed to handle the failed payment');
      throw new Error('Failed to handle the failed transfer');
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
    } catch (error) {
      this.logger.error('Failed to update the settlement status');
      throw new Error('Failed to update the settlement status');
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
   * Processes the MTN disbursement webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId } = webhookEvent;

      // Query using uniqueId in the GSI3
      const result = await this.dbService.queryByGSI(
        {
          uniqueId: externalId,
        },
        'GSI3'
      );

      if (!result.Items?.[0]) {
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      const transactionId = result.Items[0].transactionId;

      const transactionStatus = await this.mtnService.checkTransactionStatus(
        externalId,
        TransactionType.TRANSFER
      );

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
