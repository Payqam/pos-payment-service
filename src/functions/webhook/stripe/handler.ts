import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import stripe from 'stripe';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';
import { Readable } from 'stream';
import { SNSMessage } from '../../../model';
import { processWebhook } from './process';

type TransactionStatus =
  | 'INTENT_CREATE_SUCCEEDED'
  | 'INTENT_REQUIRES_PAYMENT_METHOD'
  | 'INTENT_REQUIRES_CONFIRMATION'
  | 'INTENT_REQUIRES_ACTION'
  | 'INTENT_PROCESSING'
  | 'INTENT_REQUIRES_CAPTURE'
  | 'INTENT_SUCCEEDED'
  | 'INTENT_FAILED'
  | 'INTENT_CANCELLED'
  | 'TRANSFER_CREATED'
  | 'TRANSFER_REVERSED'
  | 'CHARGE_SUCCEEDED'
  | 'CHARGE_UPDATE_SUCCEEDED'
  | 'CHARGE_FAILED'
  | 'CHARGE_REFUND_SUCCEEDED'
  | 'REFUND_CREATE_SUCCEEDED'
  | 'REFUND_UPDATE_SUCCEEDED'
  | 'REFUND_CHARGE_UPDATE_SUCCEEDED'
  | 'REFUND_FAILED';

export class StripeWebhookService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  private readonly snsService: SNSService;

  private stripeClient!: stripe;

  private signingSecret!: string;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.logger.info('init()');
  }

  public async initialize(): Promise<void> {
    const stripeSecret = await this.secretsManagerService.getSecret(
      process.env.STRIPE_API_SECRET as string
    );
    this.stripeClient = new stripe(stripeSecret.apiKey);
    this.signingSecret = stripeSecret.signingSecret;
  }

  private async getEventStream(eventBody: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const stream = Readable.from(eventBody);
      const chunks: Buffer[] = [];

      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err) => reject(err));
    });
  }

  private async publishStatusUpdate(
    transactionId: string,
    status: string,
    updateData: Record<string, unknown>
  ): Promise<void> {
    try {
      const paymentResponse = updateData.paymentResponse as {
        last_payment_error?: { code: string; message: string; type: string };
        failure_code?: string;
        failure_message?: string;
        outcome?: { type: string };
      };

      this.logger.info('Publishing status update', updateData);

      const isFailedStatus = [
        'INTENT_FAILED',
        'REFUND_FAILED',
        'CHARGE_FAILED',
      ].includes(status);

      let transactionError;

      if (isFailedStatus) {
        if (paymentResponse.last_payment_error) {
          transactionError = {
            ErrorCode: paymentResponse.last_payment_error.code,
            ErrorMessage: paymentResponse.last_payment_error.message,
            ErrorType: paymentResponse.last_payment_error.type,
            ErrorSource: 'POS',
          };
        } else if (
          paymentResponse.failure_code &&
          paymentResponse.failure_message
        ) {
          transactionError = {
            ErrorCode: paymentResponse.failure_code,
            ErrorMessage: paymentResponse.failure_message,
            ErrorType: paymentResponse.outcome?.type,
            ErrorSource: 'POS',
          };
        }
      }
      this.logger.info('TransactionId----', { transactionId });

      await this.snsService.publish({
        transactionId,
        status,
        type: isFailedStatus ? 'FAILED' : 'UPDATE',
        TransactionError: transactionError,
      } as SNSMessage);
    } catch (error) {
      this.logger.error('Failed to publish status update', { error });
    }
  }

  private getStatusPriority(status: TransactionStatus): number {
    const priorities: Record<TransactionStatus, number> = {
      INTENT_CREATE_SUCCEEDED: 1,
      INTENT_REQUIRES_PAYMENT_METHOD: 2,
      INTENT_REQUIRES_CONFIRMATION: 3,
      INTENT_REQUIRES_ACTION: 4,
      INTENT_PROCESSING: 5,
      INTENT_REQUIRES_CAPTURE: 6,
      INTENT_SUCCEEDED: 7,
      INTENT_FAILED: 8,
      INTENT_CANCELLED: 9,
      TRANSFER_CREATED: 10,
      TRANSFER_REVERSED: 11,
      CHARGE_SUCCEEDED: 12,
      CHARGE_UPDATE_SUCCEEDED: 13,
      CHARGE_FAILED: 14,
      CHARGE_REFUND_SUCCEEDED: 15,
      REFUND_CREATE_SUCCEEDED: 16,
      REFUND_UPDATE_SUCCEEDED: 17,
      REFUND_CHARGE_UPDATE_SUCCEEDED: 18,
      REFUND_FAILED: 19,
    };
    return priorities[status as TransactionStatus] || 0;
  }

  private async fetchPaymentIntentData(key: {
    uniqueId: string;
  }): Promise<{ latestStatus: string; updateData: Record<string, unknown> }> {
    this.logger.info('Fetching latest status from Stripe for INTENT');
    const paymentIntent = await this.stripeClient.paymentIntents.retrieve(
      key.uniqueId
    );
    const latestStatus = `INTENT_${paymentIntent.status.toUpperCase()}`;
    const updateData = {
      status: latestStatus,
      paymentIntentResponse: paymentIntent,
    };
    this.logger.info('updateData payment_intent', { updateData });
    return { latestStatus, updateData };
  }

  private async fetchRefundData(
    key: { uniqueId: string },
    newStatus: string
  ): Promise<{ latestStatus: string; updateData: Record<string, unknown> }> {
    this.logger.info('Fetching latest status from Stripe for REFUND');
    const refund = await this.stripeClient.refunds.retrieve(key.uniqueId);

    if (newStatus.startsWith('REFUND_CHARGE')) {
      const latestStatus = `REFUND_CHARGE_UPDATE_${refund?.status?.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        refundResponse: refund,
      };
      return { latestStatus, updateData };
    } else {
      const latestStatus = `REFUND_${refund?.status?.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        refundResponse: refund,
      };
      return { latestStatus, updateData };
    }
  }

  private async fetchChargeData(
    key: { uniqueId: string },
    newStatus: string
  ): Promise<{ latestStatus: string; updateData: Record<string, unknown> }> {
    this.logger.info('Fetching latest status from Stripe for CHARGE');
    const charge = await this.stripeClient.charges.retrieve(key.uniqueId);
    if (newStatus.startsWith('CHARGE_REFUND')) {
      const latestStatus = `CHARGE_REFUND_${charge.status.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        chargeResponse: charge,
      };
      this.logger.info('updateData charge', { updateData });
      return { latestStatus, updateData };
    } else if (newStatus.startsWith('CHARGE_UPDATE')) {
      const latestStatus = `CHARGE_UPDATE_${charge.status.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        chargeResponse: charge,
      };
      this.logger.info('updateData charge', { updateData });
      return { latestStatus, updateData };
    } else {
      const latestStatus = `CHARGE_${charge.status.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        chargeResponse: charge,
      };
      this.logger.info('updateData charge', { updateData });
      return { latestStatus, updateData };
    }
  }

  private async updateRefundResponsesArray(
    transactionId: string,
    updateData: Record<string, unknown>
  ): Promise<void> {
    this.logger.info('Updating refundResponses array');
    const transactionRecord = await this.dbService.getItem({
      transactionId: transactionId,
    });

    if (transactionRecord) {
      const existingRefunds = Array.isArray(
        transactionRecord?.Item?.refundResponses
      )
        ? transactionRecord?.Item?.refundResponses
        : [];

      const cleanUpdateData = JSON.parse(JSON.stringify(updateData));
      existingRefunds?.push(cleanUpdateData);

      await this.dbService.updatePaymentRecord(
        { transactionId: transactionId },
        { refundResponses: existingRefunds }
      );
      this.logger.info('Updated refundResponses array:', {
        refundResponses: existingRefunds,
      });
    }
  }

  private async handleStatusUpdate(
    transactionId: string,
    refundId: string | undefined,
    updateData: Record<string, unknown>
  ): Promise<void> {
    await this.publishStatusUpdate(
      transactionId,
      updateData.status as string,
      updateData
    );

    if (refundId) {
      this.logger.info('Publishing additional status update for refund', {
        refundId,
        status: updateData.status,
        amount: updateData.amount,
      });
      await this.publishStatusUpdate(
        refundId,
        updateData.status as string,
        updateData
      );
    }
  }

  private async updateRecordIfHigherStatus(
    key: { uniqueId: string },
    newStatus: string,
    type: 'refund' | 'charge' | 'payment_intent' | 'transfer',
    transactionId: string,
    refundId: string | undefined
  ): Promise<void> {
    try {
      this.logger.info('Fetching latest status from Stripe', { newStatus });

      let result: { latestStatus: string; updateData: Record<string, unknown> };

      switch (type) {
        case 'payment_intent':
          result = await this.fetchPaymentIntentData(key);
          break;
        case 'refund':
          result = await this.fetchRefundData(key, newStatus);
          break;
        case 'charge':
          result = await this.fetchChargeData(key, newStatus);
          break;
        default:
          this.logger.warn('Unsupported type', { type });
          return;
      }

      const { latestStatus, updateData } = result;

      if (!latestStatus) {
        this.logger.warn(
          'Could not fetch latest status from Stripe, skipping update.',
          {
            key,
            newStatus,
            type,
          }
        );
        return;
      }

      await this.dbService.updatePaymentRecord(
        { transactionId: transactionId },
        updateData
      );

      if (
        type === 'refund' &&
        latestStatus === 'REFUND_CHARGE_UPDATE_SUCCEEDED'
      ) {
        await this.updateRefundResponsesArray(transactionId, updateData);
      }

      const currentPriority = this.getStatusPriority(
        latestStatus as TransactionStatus
      );
      const newPriority = this.getStatusPriority(
        newStatus as TransactionStatus
      );

      this.logger.info('Status priority comparison', {
        currentPriority,
        newPriority,
        latestStatus,
        newStatus,
      });

      if (newPriority <= currentPriority) {
        this.logger.info('Skipping update due to lower or equal priority', {
          latestStatus,
          newStatus,
          currentPriority,
          newPriority,
          transactionId,
          refundId,
        });
        return;
      }

      await this.handleStatusUpdate(transactionId, refundId, updateData);

      this.logger.info('Record updated successfully', {
        transactionId,
        status: updateData.status,
        refundId,
      });
    } catch (error) {
      this.logger.error('Failed to update record', {
        error,
        transactionId,
        refundId,
        newStatus,
        type,
      });
    }
  }

  public async handlePaymentEvent(
    eventObject: stripe.PaymentIntent | stripe.Charge | stripe.Refund,
    status: string
  ): Promise<void> {
    this.logger.info(`Processing event with status: ${status}`, eventObject);
    const uniqueId = eventObject.id as string;
    const type = eventObject.object as 'payment_intent' | 'charge' | 'refund';
    const transactionId = eventObject?.metadata?.transactionId;
    const refundId = eventObject?.metadata?.refundId;
    this.logger.info('handlePaymentEvent', {
      transactionId,
      uniqueId,
      type,
      refundId,
    });
    await this.updateRecordIfHigherStatus(
      { uniqueId },
      status,
      type,
      transactionId as string,
      refundId
    );
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => processWebhook(event);
