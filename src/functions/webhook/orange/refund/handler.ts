import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';

// Webhook event interface for Orange payment notifications
interface WebhookEvent {
  type: 'payment_notification';
  data: {
    payToken: string;
  };
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

export class OrangeRefundWebhookService {
  private readonly logger: Logger;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
  }

  private async validateWebhook(
    event: APIGatewayProxyEvent
  ): Promise<WebhookEvent> {
    if (!event.body) {
      throw new WebhookError('Missing request body', 400);
    }

    try {
      const webhookEvent = JSON.parse(event.body) as WebhookEvent;

      if (
        webhookEvent.type !== 'payment_notification' ||
        !webhookEvent.data?.payToken
      ) {
        throw new WebhookError(
          'Invalid webhook payload structure',
          400,
          webhookEvent
        );
      }

      return webhookEvent;
    } catch (error) {
      throw new WebhookError(
        'Failed to parse webhook payload',
        400,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  public async handleWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      const webhookEvent = await this.validateWebhook(event);
      const { payToken } = webhookEvent.data;

      this.logger.info('Received refund webhook', {
        payToken,
        eventType: webhookEvent.type
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Refund webhook received successfully',
          payToken
        }),
      };
    } catch (error) {
      if (error instanceof WebhookError) {
        return {
          statusCode: error.statusCode,
          body: JSON.stringify({
            error: error.message,
            details: error.details,
          }),
        };
      }

      this.logger.error('Unhandled error in webhook handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Internal server error',
        }),
      };
    }
  }
}

const service = new OrangeRefundWebhookService();

export const handler: APIGatewayProxyHandler = (event) =>
  service.handleWebhook(event);
