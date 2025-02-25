import {
  APIGatewayProxyHandler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBService } from '../../../../services/dynamodbService';
import { SNSService } from '../../../../services/snsService';
import { MtnPaymentService } from '../../../transaction-process/providers';
import { WebhookEvent } from '../../../../types/mtn';

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
   * Updates the settlement status in DynamoDB
   * @throws WebhookError if update fails
   */
  private async updateSettlementStatus(
    transactionId: string,
    status: string,
    webhookEvent: WebhookEvent
  ): Promise<void> {
    this.logger.info('[DEBUG] Updating settlement status', {
      transactionId,
      status,
      webhookEvent,
    });

    try {
      const updateData = {
        settlementStatus: status,
        settlementResponse: {
          status: webhookEvent.status,
          reason: webhookEvent.reason || '',
          financialTransactionId: webhookEvent.financialTransactionId,
          payeeNote: webhookEvent.payeeNote || '',
          payerMessage: webhookEvent.payerMessage || '',
        },
      };

      await this.dbService.updatePaymentRecord(transactionId, updateData);

      this.logger.info('[DEBUG] Settlement status updated successfully', {
        transactionId,
        status,
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
    settlementId: string,
    status: string,
    amount: string,
    currency: string
  ): Promise<void> {
    try {
      await this.snsService.publish(process.env.TRANSACTION_STATUS_TOPIC_ARN!, {
        transactionId,
        settlementId,
        status,
        type: 'SETTLEMENT',
        amount,
        currency,
      });
    } catch (error) {
      throw new WebhookError('Failed to publish status update', 500, {
        error,
        transactionId,
        settlementId,
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
      const { externalId, status } = webhookEvent;

      this.logger.info('[DEBUG] Parsed disbursement webhook event', {
        webhookEvent,
        externalId,
      });

      // Query using settlementId in the SettlementIndex
      const result = await this.dbService.queryByGSI(
        {
          uniqueId: externalId,
        },
        'SettlementIndex'
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

      // const transactionStatus = await this.mtnService.checkTransactionStatus(
      //   externalId,
      //   TransactionType.TRANSFER
      // );

      this.logger.info('[DEBUG] Disbursement status from MTN', {
        externalId,
        status,
      });

      // Only update if the status is successful
      if (status === 'SUCCESSFUL') {
        this.logger.info('[DEBUG] Processing successful disbursement', {
          externalId,
          status,
        });

        await this.updateSettlementStatus(transactionId, status, webhookEvent);

        await this.publishStatusUpdate(
          transactionId,
          externalId,
          status,
          webhookEvent.amount,
          webhookEvent.currency
        );
      } else {
        this.logger.warn('[DEBUG] Disbursement status not successful', {
          externalId,
          status,
        });

        await this.updateSettlementStatus(transactionId, status, webhookEvent);
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
  const service = new MTNDisbursementWebhookService();
  return service.processWebhook(event);
};
