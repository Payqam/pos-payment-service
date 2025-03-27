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
import { PaymentResponse } from '../../../../model';
import { SecretsManagerService } from '../../../../services/secretsManagerService';
import { TEST_NUMBERS } from 'configurations/sandbox/orange/testNumbers';
import { REFUND_SCENARIOS } from 'configurations/sandbox/orange/scenarios';
import { OrangePaymentStatus } from 'src/types/orange';
import {
  EnhancedError,
  ErrorCategory,
} from '../../../../../utils/errorHandler';

// Webhook event interface for Orange payment notifications
interface WebhookEvent {
  type: 'payment_notification';
  data: {
    payToken: string;
  };
}

interface PaymentRecordUpdate {
  status?: string;
  refundMpGetResponse?: PaymentResponse['data'];
  paymentProviderResponse?: {
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

// Keeping WebhookError for backward compatibility
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
    LoggerService.setLevel('debug');
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
      throw new EnhancedError(
        'WEBHOOK_VALIDATION_ERROR',
        ErrorCategory.VALIDATION_ERROR,
        'Missing request body',
        {
          httpStatus: 400,
        }
      );
    }

    try {
      const webhookEvent = JSON.parse(event.body) as WebhookEvent;

      if (
        webhookEvent.type !== 'payment_notification' ||
        !webhookEvent.data?.payToken
      ) {
        throw new EnhancedError(
          'WEBHOOK_VALIDATION_ERROR',
          ErrorCategory.VALIDATION_ERROR,
          'Invalid webhook payload structure',
          {
            httpStatus: 400,
            originalError: webhookEvent,
          }
        );
      }

      return webhookEvent;
    } catch (error) {
      throw new EnhancedError(
        'WEBHOOK_PARSING_ERROR',
        ErrorCategory.VALIDATION_ERROR,
        'Failed to parse webhook payload',
        {
          httpStatus: 400,
          originalError: error,
          suggestedAction: 'Check the webhook payload format',
        }
      );
    }
  }

  private async getTransactionByMerchantRefundId(
    payToken: string
  ): Promise<TransactionRecord | null> {
    try {
      const result = await this.dbService.queryByGSI(
        { merchantRefundId: payToken },
        'GSI5'
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
      throw new EnhancedError(
        'TRANSACTION_RETRIEVAL_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to get transaction by merchant refund ID',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check database connectivity and GSI configuration',
          httpStatus: 500,
        }
      );
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

    // If the payment is still pending, keep it as pending
    if (status === 'PENDING') {
      return OrangePaymentStatus.MERCHANT_REFUND_PENDING;
    }

    // If we have a successful confirmation, mark as success
    if (status === 'SUCCESSFULL') {
      return OrangePaymentStatus.MERCHANT_REFUND_SUCCESSFUL;
    }

    // If init failed or confirmation failed, mark as failed
    if (status === 'FAILED') {
      return OrangePaymentStatus.MERCHANT_REFUND_FAILED;
    }

    return OrangePaymentStatus.MERCHANT_REFUND_FAILED;
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
      throw new EnhancedError(
        'PAYMENT_RECORD_UPDATE_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to update payment record',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check database connectivity and record existence',
          httpStatus: 500,
          transactionId,
        }
      );
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
        eventType: webhookEvent.type,
      });

      // Get transaction using merchantRefundId (GSI4)
      const transaction = await this.getTransactionByMerchantRefundId(payToken);
      if (!transaction) {
        throw new EnhancedError(
          'TRANSACTION_NOT_FOUND',
          ErrorCategory.VALIDATION_ERROR,
          'Transaction not found',
          {
            httpStatus: 404,
            suggestedAction: 'Verify the payToken is correct',
            originalError: { payToken },
          }
        );
      }

      // Get payment status from Orange API
      const paymentStatus = await this.orangeService.getPaymentStatus(payToken);

      const refundMpGetResponsePayload: PaymentRecordUpdate = {
        refundMpGetResponse: paymentStatus.data,
      };

      await this.updatePaymentRecord(
        transaction.transactionId,
        refundMpGetResponsePayload
      );

      // Get Orange credentials
      const credentials = await this.getOrangeCredentials();

      // Check if we're in sandbox environment
      if (credentials.targetEnvironment === 'sandbox') {
        const subscriberMsisdn = transaction.customerPhone;

        // Override refund status based on test phone numbers
        const scenarioKey = Object.entries(TEST_NUMBERS.REFUND_SCENARIOS).find(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ([_, number]) => number === subscriberMsisdn
        )?.[0];

        if (scenarioKey && scenarioKey in REFUND_SCENARIOS) {
          const scenario =
            REFUND_SCENARIOS[scenarioKey as keyof typeof REFUND_SCENARIOS];
          paymentStatus.data.status = scenario.status;
          paymentStatus.data.inittxnstatus = scenario.txnStatus;
          paymentStatus.data.inittxnmessage = scenario.message;
        }
      }

      const refundStatus = this.determineRefundStatus(paymentStatus);

      // Update transaction record
      await this.updatePaymentRecord(transaction.transactionId, {
        status: refundStatus,
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Refund webhook processed successfully',
          payToken,
          status: refundStatus,
        }),
      };
    } catch (error) {
      if (error instanceof EnhancedError) {
        return {
          statusCode: error.httpStatus || 500,
          body: JSON.stringify({
            error: error.message,
            errorCode: error.errorCode,
            category: error.category,
            details: error.originalError,
          }),
        };
      }

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

      // Convert unknown errors to EnhancedError
      const enhancedError = new EnhancedError(
        'WEBHOOK_UNHANDLED_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Internal server error',
        {
          originalError: error instanceof Error ? error : 'Unknown error',
          httpStatus: 500,
          retryable: false,
          suggestedAction: 'Check logs for detailed error information',
        }
      );

      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Internal server error',
          errorCode: enhancedError.errorCode,
          category: enhancedError.category,
        }),
      };
    }
  }
}

const service = new OrangeRefundWebhookService();

export const handler: APIGatewayProxyHandler = (event) =>
  service.handleWebhook(event);
