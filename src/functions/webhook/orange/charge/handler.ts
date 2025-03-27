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
import { PAYMENT_SCENARIOS } from 'configurations/sandbox/orange/scenarios';
import { OrangePaymentStatus } from 'src/types/orange';

// Webhook event interface for Orange payment notifications
interface WebhookEvent {
  type: 'payment_notification';
  data: {
    payToken: string;
  };
}

interface PaymentRecordUpdate {
  status?: string;
  chargeMpGetResponse?: PaymentResponse['data'];
  settlementCashInResponse?: PaymentResponse['data'];
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

export class OrangeChargeWebhookService {
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

  private async getTransactionByPayToken(
    payToken: string
  ): Promise<TransactionRecord | null> {
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
      this.logger.error('Failed to get transaction by payToken', {
        payToken,
        error,
      });
      throw new WebhookError('Failed to get transaction', 500, error);
    }
  }

  private determinePaymentStatus(paymentResponse: PaymentResponse): string {
    const status = paymentResponse.data.status;
    const initStatus = paymentResponse.data.inittxnstatus;
    const confirmStatus = paymentResponse.data.confirmtxnstatus;

    this.logger.info('Determining payment status', {
      status,
      initStatus,
      confirmStatus,
    });

    // If the payment is still pending, keep it as pending
    if (status === 'PENDING') {
      return OrangePaymentStatus.PAYMENT_PENDING;
    }

    // If we have a successful confirmation, mark as success
    if (status === 'SUCCESSFULL') {
      return OrangePaymentStatus.PAYMENT_SUCCESSFUL;
    }

    // If init failed or confirmation failed, mark as failed
    if (status === 'FAILED') {
      return OrangePaymentStatus.PAYMENT_FAILED;
    }

    return status || OrangePaymentStatus.PAYMENT_FAILED; // Default to failed if status is unclear
  }

  /**
   * Removes undefined values from an object recursively
   */
  private removeUndefined(obj: any): any {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    if (Array.isArray(obj)) {
      return obj
        .map((item) => this.removeUndefined(item))
        .filter((item) => item !== undefined);
    }

    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const key in obj) {
        const value = this.removeUndefined(obj[key]);
        if (value !== undefined) {
          cleaned[key] = value;
        }
      }
      return Object.keys(cleaned).length ? cleaned : undefined;
    }

    return obj;
  }

  private async updatePaymentRecord(
    transactionId: string,
    update: PaymentRecordUpdate
  ): Promise<void> {
    try {
      // Clean the update payload by removing undefined values
      const cleanedUpdate = this.removeUndefined(update);

      if (!cleanedUpdate) {
        throw new Error(
          'Update payload is empty after cleaning undefined values'
        );
      }

      // Create the key object with the correct structure
      const key = { transactionId };

      await this.dbService.updatePaymentRecord(key, cleanedUpdate);
    } catch (error) {
      this.logger.error('Error updating payment record', {
        error,
        transactionId,
        update: JSON.stringify(update),
      });
      throw new WebhookError('Failed to update payment record', 500, error);
    }
  }

  private async publishStatusUpdate(
    transactionId: string,
    status: string,
    amount: string,
    paymentResponse: PaymentResponse['data']
  ): Promise<void> {
    try {
      const isFailedStatus = status === 'FAILED';
      let transactionError;

      if (isFailedStatus) {
        transactionError = {
          ErrorCode:
            paymentResponse.inittxnstatus ||
            paymentResponse.confirmtxnstatus ||
            'UNKNOWN',
          ErrorMessage: paymentResponse.inittxnmessage || 'Transaction failed',
          ErrorType: 'payment_failed',
          ErrorSource: 'ORANGE',
        };
      }

      await this.snsService.publish({
        transactionId,
        status,
        type: isFailedStatus ? 'FAILED' : 'UPDATE',
        amount,
        TransactionError: transactionError,
        paymentMethod: 'ORANGE',
        metadata: {
          payToken: paymentResponse.payToken,
          txnid: paymentResponse.txnid,
        },
      });
    } catch (error) {
      this.logger.error('Failed to publish status update', { error });
      throw new WebhookError('Failed to publish status update', 500, error);
    }
  }

  private async getOrangeCredentials() {
    return this.secretsManagerService.getSecret(
      process.env.ORANGE_API_SECRET as string
    );
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
        throw new Error('Merchant mobile number not found');
      }

      // Get Orange credentials from Secrets Manager
      const credentials = await this.getOrangeCredentials();

      // Calculate disbursement amount (90% of payment amount)
      const disbursementAmount = Math.floor(
        parseFloat(amount) * 0.9
      ).toString();

      // Initialize disbursement
      const initResponse = await this.orangeService.initiateCashinTransaction();

      if (!initResponse.data?.payToken) {
        throw new Error('Failed to get payToken for disbursement');
      }

      // Execute disbursement
      const disbursementResponse =
        await this.orangeService.executeCashinPayment({
          channelUserMsisdn: credentials.merchantPhone,
          amount: disbursementAmount,
          subscriberMsisdn: transaction.merchantMobileNo,
          orderId: `${transaction.orderId}`,
          description: `Disbursement for transaction ${transaction.transactionId}`,
          payToken: initResponse.data.payToken,
        });

      const disbursementResponsePayload: PaymentRecordUpdate = {
        settlementCashInResponse: disbursementResponse.data,
      };

      await this.updatePaymentRecord(
        transaction.transactionId,
        disbursementResponsePayload
      );

      const result = {
        status: disbursementResponse.data.status,
        payToken: initResponse.data.payToken,
        orderId: `${transaction.orderId}`,
      };

      this.logger.info('Disbursement processed successfully', {
        transactionId: transaction.transactionId,
        disbursementAmount,
        result,
      });

      return result;
    } catch (error) {
      this.logger.error('Disbursement failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId: transaction.transactionId,
      });
      return { status: 'FAILED' };
    }
  }

  public async handleWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      const webhookEvent = await this.validateWebhook(event);
      const { payToken } = webhookEvent.data;

      // Get transaction using payToken from GSI3
      const transaction = await this.getTransactionByPayToken(payToken);
      if (!transaction) {
        throw new WebhookError('Transaction not found for payToken', 404);
      }

      // Get the current payment status from Orange API
      const paymentResponse =
        await this.orangeService.getPaymentStatus(payToken);

      const getpaymentResponsePayload: PaymentRecordUpdate = {
        chargeMpGetResponse: paymentResponse.data,
      };

      await this.updatePaymentRecord(
        transaction.transactionId,
        getpaymentResponsePayload
      );

      // Get Orange credentials
      const credentials = await this.getOrangeCredentials();

      // Check if we're in sandbox environment
      if (credentials.targetEnvironment === 'sandbox') {
        const subscriberMsisdn = paymentResponse.data.subscriberMsisdn;

        // Override payment status based on test phone numbers
        const scenarioKey = Object.entries(TEST_NUMBERS.PAYMENT_SCENARIOS).find(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ([_, number]) => number === subscriberMsisdn
        )?.[0];

        if (scenarioKey && scenarioKey in PAYMENT_SCENARIOS) {
          const scenario =
            PAYMENT_SCENARIOS[scenarioKey as keyof typeof PAYMENT_SCENARIOS];
          paymentResponse.data.status = scenario.status;
          paymentResponse.data.inittxnstatus = scenario.txnStatus;
          paymentResponse.data.inittxnmessage = scenario.message;
        }
      }

      // Determine final payment status from the API response
      const status = this.determinePaymentStatus(paymentResponse);

      // Don't process disbursement for pending payments
      if (status === OrangePaymentStatus.PAYMENT_PENDING) {
        const updatePayload: PaymentRecordUpdate = {
          status: OrangePaymentStatus.PAYMENT_PENDING,
        };

        await this.updatePaymentRecord(
          transaction.transactionId,
          updatePayload
        );

        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'Payment is still pending' }),
        };
      }

      const updatePayload: PaymentRecordUpdate = {
        status: OrangePaymentStatus.PAYMENT_SUCCESSFUL,
      };

      // // TEMPORARY: Process disbursement for failed payments (testing only)
      // this.logger.info('SANDBOX: Processing disbursement for testing', {
      //   status,
      // });
      if (status === OrangePaymentStatus.PAYMENT_SUCCESSFUL) {
        const disbursementResult = await this.processDisbursement(
          transaction,
          transaction.amount.toString()
        );

        this.logger.debug('Checking disbursement result status', {
          status: disbursementResult.status,
          typeofStatus: typeof disbursementResult.status,
          isSuccessful: disbursementResult.status === 'SUCCESSFULL',
        });

        // Only add disbursement data if we have valid results
        if (disbursementResult.status === 'SUCCESSFULL') {
          this.logger.debug('Inside successful disbursement block');
          Object.assign(updatePayload, {
            settlementStatus: OrangePaymentStatus.DISBURSEMENT_SUCCESSFUL,
            settlementPayToken: disbursementResult.payToken,
            settlementResponse: {
              status: disbursementResult.status,
              orderId: disbursementResult.orderId,
            },
            settlementAmount: transaction.settlementAmount,
          });
        } else {
          this.logger.debug('Inside failed disbursement block', {
            status: disbursementResult.status,
          });
          updatePayload.settlementStatus =
            OrangePaymentStatus.DISBURSEMENT_FAILED;
        }
      }

      // Update the transaction record
      await this.updatePaymentRecord(transaction.transactionId, updatePayload);

      // Publish the status update using transaction data
      await this.publishStatusUpdate(
        transaction.transactionId,
        status,
        transaction.amount.toString(),
        paymentResponse.data
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Webhook processed successfully',
          status,
          transactionId: transaction.transactionId,
        }),
      };
    } catch (error) {
      if (error instanceof WebhookError) {
        return {
          statusCode: error.statusCode,
          body: JSON.stringify({ error: error.message }),
        };
      }

      this.logger.error('Webhook processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  }
}

const service = new OrangeChargeWebhookService();

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return service.handleWebhook(event);
};
