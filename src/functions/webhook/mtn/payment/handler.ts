import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { MtnPaymentService } from '../../../transaction-process/providers';
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

interface PaymentRecordUpdate {
  status: string;
  paymentProviderResponse?: {
    status: string;
    reason?: string;
  };
  settlementId?: string;
  settlementStatus?: string;
  settlementDate?: number;
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

export class MTNPaymentWebhookService {
  private readonly logger: Logger;

  private readonly mtnService: MtnPaymentService;

  private readonly dbService: DynamoDBService;

  private readonly snsService: SNSService;

  private readonly instantDisbursementEnabled: boolean;

  private readonly payqamFeePercentage: number;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.mtnService = new MtnPaymentService();
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.instantDisbursementEnabled =
      process.env.INSTANT_DISBURSEMENT_ENABLED === 'true';
    this.payqamFeePercentage = parseFloat(
      process.env.PAYQAM_FEE_PERCENTAGE || '2.5'
    );
    this.logger.info('init()');
  }

  /**
   * Calculates the merchant's settlement amount after deducting PayQAM's fee
   */
  private calculateSettlementAmount(amount: number): number {
    const feePercentage = this.payqamFeePercentage / 100;
    const fee = amount * feePercentage;
    return amount - fee;
  }

  /**
   * Processes instant disbursement for a successful payment
   * @throws WebhookError if disbursement processing fails
   */
  private async processInstantDisbursement(
    transactionId: string,
    amount: number,
    currency: string
  ): Promise<string> {
    try {
      this.logger.info('Processing instant disbursement', {
        transactionId,
        amount,
        currency,
      });

      const result = await this.dbService.getItem({
        transactionId,
      });

      if (!result?.Item) {
        throw new WebhookError('Transaction not found for disbursement', 404, {
          transactionId,
        });
      }

      const settlementId = await this.mtnService.initiateTransfer(
        amount,
        result.Item.merchantMobileNo,
        currency
      );

      if (!settlementId) {
        throw new WebhookError('Failed to initiate transfer', 500, {
          transactionId,
          amount,
          currency,
        });
      }

      return settlementId;
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError('Error processing instant disbursement', 500, {
        error,
        transactionId,
        amount,
      });
    }
  }

  /**
   * Handles successful payment processing
   * @throws WebhookError if processing fails
   */
  private async handleSuccessfulPayment(
    externalId: string,
    amount: string,
    currency: string,
    webhookEvent: WebhookEvent
  ): Promise<PaymentRecordUpdate> {
    const amountNumber = parseFloat(amount);
    const settlementAmount = this.calculateSettlementAmount(amountNumber);
    const updateData: PaymentRecordUpdate = {
      status: 'SUCCESS',
      paymentProviderResponse: {
        status: webhookEvent.status,
        reason: webhookEvent.payeeNote,
      },
      fee: amountNumber - settlementAmount,
    };

    if (this.instantDisbursementEnabled) {
      try {
        updateData.settlementId = await this.processInstantDisbursement(
          externalId,
          settlementAmount,
          currency
        );
        updateData.settlementStatus = 'PENDING';
        updateData.settlementDate = Date.now();
        updateData.settlementAmount = settlementAmount;
      } catch (error) {
        this.logger.error('Failed to process instant disbursement', { error });
        // Continue with payment success even if disbursement fails
      }
    }

    return updateData;
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
   * Processes the MTN payment webhook
   */
  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      this.logger.info('Received MTN webhook event', { event });

      const webhookEvent = this.parseWebhookEvent(event.body);
      const { externalId, amount, currency, status } = webhookEvent;

      const result = await this.dbService.getItem({
        transactionId: externalId,
      });

      if (!result?.Item) {
        throw new WebhookError(`Transaction not found: ${externalId}`, 404);
      }

      const updateData =
        status === 'SUCCESSFUL'
          ? await this.handleSuccessfulPayment(
              externalId,
              amount,
              currency,
              webhookEvent
            )
          : {
              status: 'FAILED',
              paymentProviderResponse: {
                status: webhookEvent.status,
                reason: webhookEvent.payeeNote,
              },
            };

      await this.dbService.updatePaymentRecordByTransactionId(
        externalId,
        updateData
      );

      await this.snsService.publish(process.env.TRANSACTION_STATUS_TOPIC_ARN!, {
        transactionId: externalId,
        status: updateData.status,
        type: 'PAYMENT',
        amount: amount,
        currency: currency,
        settlementId: updateData.settlementId,
        settlementStatus: updateData.settlementStatus,
      });

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
  const service = new MTNPaymentWebhookService();
  return service.processWebhook(event);
};
