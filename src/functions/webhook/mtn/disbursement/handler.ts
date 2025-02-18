import {
  APIGatewayProxyHandler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBService } from '../../../../services/dynamodbService';
import { SNSService } from '../../../../services/snsService';

interface WebhookEvent {
  financialTransactionId: string;
  externalId: string;
  amount: string;
  currency: string;
  payer: {
    partyIdType: string;
    partyId: string;
  };
  payeeNote?: string;
  status: string;
}

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

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
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
    try {
      await this.dbService.updatePaymentRecordByTransactionId(transactionId, {
        settlementStatus: status === 'SUCCESSFUL' ? 'SUCCESS' : 'FAILED',
        settlementResponse: webhookEvent,
      });
    } catch (error) {
      throw new WebhookError('Failed to update settlement status', 500, {
        error,
        transactionId,
        status,
      });
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
      throw new WebhookError('No body in webhook event', 400);
    }

    try {
      const event = JSON.parse(body) as WebhookEvent;

      // Validate required fields
      if (
        !event.externalId ||
        !event.amount ||
        !event.currency ||
        !event.status
      ) {
        throw new WebhookError(
          'Missing required fields in webhook event',
          400,
          { event }
        );
      }

      return event;
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError('Invalid webhook payload', 400, { error });
    }
  }

  /**
   * Processes the MTN disbursement webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      this.logger.info('Received MTN webhook event', { event });

      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId, amount, currency, status } = webhookEvent;

      // Get transaction by settlementId using GSI
      const result = await this.dbService.getItem(
        {
          settlementId: externalId,
        },
        'SettlementIndex'
      );

      if (!result?.Item) {
        throw new WebhookError(
          `Transaction not found for settlement: ${externalId}`,
          404
        );
      }

      await this.updateSettlementStatus(
        result.Item.transactionId,
        status,
        webhookEvent
      );

      await this.publishStatusUpdate(
        result.Item.transactionId,
        externalId,
        status,
        amount,
        currency
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
