import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import { OrangePaymentService } from '../../../transaction-process/providers';
import {
  DynamoDBService,
  TransactionRecord,
} from '../../../../services/dynamodbService';
import { SNSService } from '../../../../services/snsService';
import { PaymentResponse } from '../../../transaction-process/interfaces/orange';
import { SecretsManagerService } from '../../../../services/secretsManagerService';
import { TEST_NUMBERS } from 'configurations/sandbox/orange/testNumbers';
import { REFUND_SCENARIOS, PaymentScenario } from 'configurations/sandbox/orange/scenarios';
import { PAYMENT_SCENARIOS } from 'configurations/sandbox/orange/scenarios';

// Webhook event interface for Orange payment notifications
interface WebhookEvent {
  type: 'payment_notification';
  data: {
    payToken: string;
  };
}

interface PaymentRecordUpdate {
  status: string;
  paymentProviderResponse: {
    status: string;
    inittxnstatus?: string;
    confirmtxnstatus?: string;
  };
  settlementStatus?: string;
  settlementAmount?: number;
  settlementPayToken?: string;
  settlementResponse?: {
    status: string;
    orderId?: string;
  };
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

export class OrangeRefundWebhookService {
  private readonly logger: Logger;
  private readonly dbService: DynamoDBService;
  private readonly snsService: SNSService;
  private readonly orangeService: OrangePaymentService;
  private readonly secretsManagerService: SecretsManagerService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.orangeService = new OrangePaymentService();
    this.secretsManagerService = new SecretsManagerService();
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

  private async getTransactionByMerchantRefundId(
    payToken: string
  ): Promise<TransactionRecord | null> {
    try {
      const result = await this.dbService.queryByGSI(
        { merchantRefundId: payToken },
        'GSI4'
      );

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      return result.Items[0] as TransactionRecord;
    } catch (error) {
      this.logger.error('Failed to get transaction by merchantRefundId', {
        payToken,
        error,
      });
      throw new WebhookError('Failed to get transaction', 500, error);
    }
  }

  private determineRefundStatus(paymentResponse: PaymentResponse): string {
    const status = paymentResponse.data.status;
    const initStatus = paymentResponse.data.inittxnstatus;
    const confirmStatus = paymentResponse.data.confirmtxnstatus;

    this.logger.info('Determining refund status', {
      status,
      initStatus,
      confirmStatus,
    });

    if (confirmStatus === '200') {
      return 'REFUNDED';
    }

    if (initStatus !== '200' || (confirmStatus && confirmStatus !== '200')) {
      return 'REFUND_FAILED';
    }

    if (status === 'PENDING' && initStatus === '200' && !confirmStatus) {
      return 'REFUND_PENDING';
    }

    return 'REFUND_FAILED';
  }

  private async updatePaymentRecord(
    transactionId: string,
    update: PaymentRecordUpdate
  ): Promise<void> {
    try {
      const key = { transactionId };
      await this.dbService.updatePaymentRecord(key, update);
    } catch (error) {
      this.logger.error('Failed to update payment record', {
        transactionId,
        error,
      });
      throw new WebhookError('Failed to update payment record', 500, error);
    }
  }

  private async getOrangeCredentials(): Promise<any> {
    return this.secretsManagerService.getSecret(
      process.env.ORANGE_API_SECRET as string
    );
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

      // Get transaction using merchantRefundId (GSI4)
      const transaction = await this.getTransactionByMerchantRefundId(payToken);
      if (!transaction) {
        throw new WebhookError('Transaction not found', 404, { payToken });
      }

      // Get payment status from Orange API
      const paymentStatus = await this.orangeService.getPaymentStatus(payToken);

      // Get Orange credentials
      const credentials = await this.getOrangeCredentials();

      // Check if we're in sandbox environment
      if (credentials.environment === 'sandbox') {
        const subscriberMsisdn = transaction.customerPhone;

        // Override refund status based on test phone numbers
        const scenarioKey = Object.entries(TEST_NUMBERS.REFUND_SCENARIOS)
          .find(([_, number]) => number === subscriberMsisdn)?.[0];

        if (scenarioKey && scenarioKey in REFUND_SCENARIOS) {
          const scenario = REFUND_SCENARIOS[scenarioKey as keyof typeof REFUND_SCENARIOS];
          paymentStatus.data.status = scenario.status;
          paymentStatus.data.inittxnstatus = scenario.txnStatus;
          paymentStatus.data.inittxnmessage = scenario.message;
        }
      }

      const refundStatus = this.determineRefundStatus(paymentStatus);

      // Update transaction record
      await this.updatePaymentRecord(transaction.transactionId, {
        status: refundStatus,
        paymentProviderResponse: {
          status: paymentStatus.data.status,
          inittxnstatus: paymentStatus.data.inittxnstatus,
          confirmtxnstatus: paymentStatus.data.confirmtxnstatus ?? undefined
        }
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Refund webhook processed successfully',
          payToken,
          status: refundStatus
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
