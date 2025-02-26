import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { OrangePaymentService } from '../../transaction-process/providers';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';
import { PaymentResponse } from '../../transaction-process/interfaces/orange';

interface WebhookEvent {
  type: 'payment_notification';
  data: {
    transactionId: string;
    payToken: string;
    status: string;
    amount: string;
    currency: string;
  };
}

interface PaymentRecordUpdate {
  status: string;
  paymentProviderResponse?: {
    status: string;
    inittxnstatus?: string;
  };
  settlementAmount?: number;
  fee?: number;
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

export class OrangeWebhookService {
  private readonly logger: Logger;
  private readonly dbService: DynamoDBService;
  private readonly snsService: SNSService;
  private readonly orangeService: OrangePaymentService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.orangeService = new OrangePaymentService();
  }

  private async validateWebhook(event: APIGatewayProxyEvent): Promise<WebhookEvent> {
    if (!event.body) {
      throw new WebhookError('No body found in the webhook', 400);
    }

    try {
      const webhookEvent = JSON.parse(event.body) as WebhookEvent;
      
      if (
        webhookEvent.type !== 'payment_notification' ||
        !webhookEvent.data?.transactionId ||
        !webhookEvent.data?.payToken ||
        !webhookEvent.data?.status ||
        !webhookEvent.data?.amount ||
        !webhookEvent.data?.currency
      ) {
        throw new WebhookError('Invalid webhook payload', 400);
      }

      return webhookEvent;
    } catch (error) {
      throw new WebhookError('Failed to parse webhook payload', 400, error);
    }
  }

  private determinePaymentStatus(paymentResponse: PaymentResponse): string {
    const { status, inittxnstatus } = paymentResponse.data;
    
    // Check status first
    if (status === 'SUCCESS') {
      return 'SUCCESS';
    }
    
    // Check if payment was rejected or failed
    if (status === 'FAILED' || inittxnstatus === 'FAILED') {
      return 'FAILED';
    }
    
    // If still processing
    if (inittxnstatus === 'SUCCESS') {
      return 'PENDING';
    }
    
    return 'FAILED'; // Default to failed if status is unclear
  }

  private async updatePaymentRecord(
    transactionId: string,
    update: PaymentRecordUpdate
  ): Promise<void> {
    try {
      await this.dbService.updatePaymentRecordByTransactionId(
        transactionId,
        update
      );
    } catch (error) {
      throw new WebhookError('Failed to update payment record', 500, error);
    }
  }

  private async publishStatusUpdate(
    transactionId: string,
    status: string,
    amount: string,
    currency: string
  ): Promise<void> {
    try {
      await this.snsService.publish(process.env.TRANSACTION_STATUS_TOPIC_ARN!, {
        transactionId,
        status,
        type: 'UPDATE',
        amount,
        currency,
      });
    } catch (error) {
      this.logger.error('Failed to publish status update', { error });
      throw new WebhookError('Failed to publish status update', 500, error);
    }
  }

  public async handleWebhook(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
      const webhookEvent = await this.validateWebhook(event);
      const { transactionId, payToken, amount, currency } = webhookEvent.data;

      // Get the current payment status from Orange API
      const paymentResponse = await this.orangeService.getPaymentStatus(payToken);
      
      // Determine final payment status from the API response
      const status = this.determinePaymentStatus(paymentResponse);

      // Update payment record with status and response details
      await this.updatePaymentRecord(transactionId, {
        status,
        paymentProviderResponse: {
          status,
          inittxnstatus: paymentResponse.data.inittxnstatus,
        },
      });

      // Publish status update
      await this.publishStatusUpdate(transactionId, status, amount, currency);

      return {
        statusCode: 200,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ message: 'Webhook processed successfully' }),
      };
    } catch (error) {
      if (error instanceof WebhookError) {
        return {
          statusCode: error.statusCode,
          headers: API.DEFAULT_HEADERS,
          body: JSON.stringify({ error: error.message }),
        };
      }

      return {
        statusCode: 500,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  }
}

const service = new OrangeWebhookService();

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return service.handleWebhook(event);
};
