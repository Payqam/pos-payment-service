import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { OrangePaymentService } from '../../transaction-process/providers';
import { DynamoDBService, TransactionRecord } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';
import { PaymentResponse } from '../../transaction-process/interfaces/orange';

interface WebhookEvent {
  type: 'payment_notification';
  data: {
    payToken: string;
    status: string;
    amount: string;
    currency: string;
  };
}

interface PaymentRecordUpdate {
  status: string;
  paymentProviderResponse: {
    status: string;
    inittxnstatus?: string;
  };
  disbursementStatus?: string;
  disbursementAmount?: number;
  disbursementPayToken?: string;
  disbursementResponse?: {
    status: string;
    inittxnstatus?: string;
    orderId?: string;
  };
  fee?: number;
  settlementAmount?: number;
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

  private async getTransactionByPayToken(payToken: string): Promise<TransactionRecord | null> {
    try {
      const result = await this.dbService.queryByGSI(
        { uniqueId: payToken },
        'GSI3'
      );

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      // Since GSI3 projects all attributes, we can directly use the item
      return result.Items[0] as TransactionRecord;
    } catch (error) {
      this.logger.error('Failed to get transaction by payToken', { payToken, error });
      throw new WebhookError('Failed to get transaction', 500, error);
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

  private async processDisbursement(
    transaction: TransactionRecord,
    amount: string
  ): Promise<{
    status: string;
    payToken?: string;
    orderId?: string;
  }> {
    try {
      if (!transaction.merchantMobileNo) {
        this.logger.error('Merchant mobile number not found', { transactionId: transaction.transactionId });
        return { status: 'FAILED' };
      }

      // Calculate disbursement amount (90% of payment amount)
      const disbursementAmount = Math.floor(parseFloat(amount) * 0.9).toString();
      
      // Initialize disbursement
      const initResponse = await this.orangeService.initDisbursement();
      
      if (!initResponse.data?.payToken) {
        this.logger.error('Failed to get payToken for disbursement', { transactionId: transaction.transactionId });
        return { status: 'FAILED' };
      }

      // Execute disbursement
      const disbursementResponse = await this.orangeService.executeDisbursement({
        channelUserMsisdn: process.env.ORANGE_CHANNEL_MSISDN!,
        amount: disbursementAmount,
        subscriberMsisdn: transaction.merchantMobileNo,
        orderId: `DISB_${transaction.transactionId}`,
        description: `Disbursement for transaction ${transaction.transactionId}`,
        payToken: initResponse.data.payToken
      });

      return {
        status: disbursementResponse.data.status,
        payToken: initResponse.data.payToken,
        orderId: `DISB_${transaction.transactionId}`
      };
    } catch (error) {
      this.logger.error('Disbursement failed', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId: transaction.transactionId 
      });
      return { status: 'FAILED' };
    }
  }

  public async handleWebhook(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
      const webhookEvent = await this.validateWebhook(event);
      const { payToken, status: webhookStatus, amount, currency } = webhookEvent.data;

      // Get transaction using payToken from GSI3
      const transaction = await this.getTransactionByPayToken(payToken);
      if (!transaction) {
        throw new WebhookError('Transaction not found for payToken', 404);
      }

      // Get the current payment status from Orange API
      const paymentResponse = await this.orangeService.getPaymentStatus(payToken);
      
      // Determine final payment status from the API response
      const status = this.determinePaymentStatus(paymentResponse);

      const updatePayload: PaymentRecordUpdate = {
        status,
        paymentProviderResponse: {
          status,
          ...(paymentResponse.data.inittxnstatus && {
            inittxnstatus: paymentResponse.data.inittxnstatus
          })
        }
      };

      // TEMPORARY: Process disbursement regardless of status for testing
      // TODO: Change back to if (status === 'SUCCESS') for production
      if (true) { // Always process disbursement for testing
        this.logger.info('Processing disbursement for testing', { 
          status, 
          transactionId: transaction.transactionId 
        });
        
        const disbursementResult = await this.processDisbursement(transaction, amount);
        
        // Calculate and store fee and settlement amount
        const paymentAmount = parseFloat(amount);
        const fee = Math.floor(paymentAmount * 0.1);
        const settlementAmount = paymentAmount - fee;

        // Only add defined values to avoid DynamoDB errors
        if (disbursementResult.status) {
          updatePayload.disbursementStatus = disbursementResult.status;
        }
        if (disbursementResult.payToken) {
          updatePayload.disbursementPayToken = disbursementResult.payToken;
        }
        if (disbursementResult.orderId) {
          updatePayload.disbursementResponse = {
            status: disbursementResult.status,
            orderId: disbursementResult.orderId
          };
        }
        updatePayload.fee = fee;
        updatePayload.settlementAmount = settlementAmount;
        updatePayload.disbursementAmount = settlementAmount;
      }

      // Update payment record with status and response details
      await this.updatePaymentRecord(transaction.transactionId, updatePayload);

      // Publish status update
      await this.publishStatusUpdate(transaction.transactionId, status, amount, currency);

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
