import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  registerRedactFilter,
  maskMobileNumber,
} from '../../../../../utils/redactUtil';
import { DynamoDBService } from '../../../../services/dynamodbService';
import { SNSService } from '../../../../services/snsService';
import {
  MtnPaymentService,
  TransactionType,
} from '../../../transaction-process/providers';
import {
  MTN_TRANSFER_ERROR_MAPPINGS,
  MTNPaymentStatus,
  MTNTransferErrorReason,
  WebhookEvent,
} from '../../../../types/mtn';
import {
  EnhancedError,
  ErrorCategory,
} from '../../../../../utils/errorHandler';

// Register redaction filter for masking sensitive data in logs
registerRedactFilter();

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
    merchantId: string,
    transactionStatus: WebhookEvent
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.debug('Processing failed transfer webhook', {
        transactionId,
        status: transactionStatus.status,
        reason: transactionStatus.reason,
        amount: transactionStatus.amount,
        currency: transactionStatus.currency,
        payeePartyIdType: transactionStatus.payee?.partyIdType,
        payeePartyId: transactionStatus.payee?.partyId
          ? maskMobileNumber(transactionStatus.payee.partyId)
          : undefined,
      });

      const errorReason = transactionStatus.reason;
      const errorMapping =
        MTN_TRANSFER_ERROR_MAPPINGS[errorReason as MTNTransferErrorReason];

      this.logger.debug('Mapped error details', {
        transactionId,
        errorReason,
        errorMapping: {
          statusCode: errorMapping.statusCode,
          label: errorMapping.label,
          message: errorMapping.message,
          retryable: errorMapping.retryable,
        },
      });

      this.logger.debug('Publishing disbursement failure notification', {
        transactionId,
        status: MTNPaymentStatus.DISBURSEMENT_FAILED,
        errorCode: errorMapping.statusCode,
        errorType: errorMapping.label,
      });

      await this.snsService.publish({
        transactionId,
        merchantId,
        status: MTNPaymentStatus.DISBURSEMENT_FAILED,
        type: 'CREATE',
        TransactionError: {
          ErrorCode: errorMapping.statusCode,
          ErrorMessage: errorReason,
          ErrorType: errorMapping.label,
          ErrorSource: 'pos',
        },
      });

      this.logger.debug(
        'Successfully published disbursement failure notification',
        {
          transactionId,
        }
      );

      if (
        errorReason === 'INTERNAL_PROCESSING_ERROR' ||
        errorReason === 'SERVICE_UNAVAILABLE'
      ) {
        this.logger.debug(
          'Retryable error detected, checking transaction details',
          {
            transactionId,
            errorReason,
          }
        );

        const transactionDetails = await this.dbService.getItem<{
          transactionId: string;
        }>({
          transactionId,
        });

        const settlementResponse = transactionDetails?.Item;

        this.logger.debug(
          'Retrieved transaction details for retry assessment',
          {
            transactionId,
            hasSettlementRetryResponse:
              !!settlementResponse?.settlementRetryResponse,
            retryCount: settlementResponse?.settlementRetryResponse?.retryCount,
          }
        );

        if (
          !settlementResponse?.settlementRetryResponse ||
          (settlementResponse?.settlementRetryResponse &&
            settlementResponse.settlementRetryResponse.retryCount <= 3)
        ) {
          const maxRetries = 3;
          let retryCount = 0;

          this.logger.debug('Starting retry process for failed disbursement', {
            transactionId,
            maxRetries,
            currentRetryCount:
              settlementResponse?.settlementRetryResponse?.retryCount || 0,
          });

          while (retryCount < maxRetries) {
            try {
              this.logger.debug(
                `Retry attempt ${retryCount + 1} for transaction`,
                {
                  transactionId,
                  retryCount: retryCount + 1,
                  amount: transactionStatus.amount,
                  currency: transactionStatus.currency,
                  payeePartyId: transactionStatus.payee?.partyId
                    ? maskMobileNumber(transactionStatus.payee.partyId)
                    : undefined,
                }
              );

              const newTransactionId = await this.mtnService.initiateTransfer(
                parseFloat(transactionStatus.amount),
                transactionStatus?.payee?.partyId as string,
                transactionStatus.currency,
                TransactionType.TRANSFER
              );

              this.logger.info('Retry successful with new transaction ID', {
                originalTransactionId: transactionId,
                newTransactionId,
                retryCount: retryCount + 1,
              });

              return {
                Status: MTNPaymentStatus.RETRYING_DISBURSEMENT,
                uniqueId: newTransactionId,
                disbursementRetryResponse: {
                  retryCount: retryCount + 1,
                  newTransactionId,
                  reason: errorReason,
                },
              };
            } catch (retryError) {
              this.logger.error(`Retry ${retryCount + 1} failed`, {
                error:
                  retryError instanceof Error
                    ? {
                        name: retryError.name,
                        message: retryError.message,
                        stack: retryError.stack,
                      }
                    : String(retryError),
                transactionId,
                retryCount: retryCount + 1,
              });
              retryCount++;
            }
          }

          this.logger.warn('All retry attempts failed for disbursement', {
            transactionId,
            maxRetries,
            errorReason,
          });
        } else {
          this.logger.warn(
            'Maximum retry attempts already reached, not retrying',
            {
              transactionId,
              retryCount:
                settlementResponse?.settlementRetryResponse?.retryCount,
            }
          );
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

      this.logger.debug('Created enhanced error for failed disbursement', {
        transactionId,
        errorCategory: enhancedError.category,
        errorMessage: enhancedError.message,
        retryable: errorMapping.retryable,
      });

      return {
        status: MTNPaymentStatus.DISBURSEMENT_FAILED,
        disbursementResponse: {
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
      this.logger.error('Failed to handle the failed transfer', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        transactionId,
      });
      throw new Error('Failed to handle the failed transfer');
    }
  }

  /**
   * Updates the settlement status in DynamoDB
   * @throws WebhookError if update fails
   */
  private async updateSettlementStatus(
    transactionId: string,
    merchantId: string,
    transactionStatusResponse: WebhookEvent
  ): Promise<void> {
    try {
      this.logger.debug('Updating settlement status', {
        transactionId,
        status: transactionStatusResponse.status,
        financialTransactionId:
          transactionStatusResponse.financialTransactionId,
      });

      const dateTime = new Date().toISOString();
      const updateData =
        transactionStatusResponse.status === 'SUCCESSFUL'
          ? {
              status: MTNPaymentStatus.DISBURSEMENT_SUCCESSFUL,
              disbursementResponse: transactionStatusResponse,
              updatedOn: dateTime,
            }
          : await this.handleFailedTransfer(
              transactionId,
              merchantId,
              transactionStatusResponse
            );

      this.logger.debug('Prepared update data for settlement status', {
        transactionId,
        status: updateData.status,
        updatedOn: dateTime,
      });

      if (transactionStatusResponse.status === 'SUCCESSFUL') {
        this.logger.debug('Publishing successful disbursement notification', {
          transactionId,
          status: MTNPaymentStatus.DISBURSEMENT_SUCCESSFUL,
        });

        await this.snsService.publish({
          transactionId,
          status: MTNPaymentStatus.DISBURSEMENT_SUCCESSFUL,
          type: 'CREATE',
          createdOn: dateTime,
        });

        this.logger.debug(
          'Successfully published disbursement success notification',
          {
            transactionId,
          }
        );
      }

      this.logger.debug('Updating payment record with settlement status', {
        transactionId,
        status: updateData.status,
      });

      await this.dbService.updatePaymentRecord({ transactionId }, updateData);

      this.logger.debug(
        'Successfully updated payment record with settlement status',
        {
          transactionId,
          status: updateData.status,
        }
      );
    } catch (error) {
      this.logger.error('Failed to update the settlement status', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        transactionId,
      });
      throw new WebhookError('Failed to update settlement status', 500, {
        transactionId,
        error,
      });
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
      await this.snsService.publish({
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

      await this.updateSettlementStatus(
        transactionId,
        result.Items?.[0].merchantId,
        transactionStatus
      );

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
