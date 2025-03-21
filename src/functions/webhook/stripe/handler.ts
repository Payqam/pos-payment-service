import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import stripe from 'stripe';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';
import { Readable } from 'stream';
import {SNSMessage } from '../../../model';

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
    amount: string,
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
          // Handle INTENT_FAILED structure
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
          // Handle CHARGE_FAILED structure
          transactionError = {
            ErrorCode: paymentResponse.failure_code,
            ErrorMessage: paymentResponse.failure_message,
            ErrorType: paymentResponse.outcome?.type,
            ErrorSource: 'POS',
          };
        }
      }

      await this.snsService.publish( {
        transactionId,
        status,
        type: isFailedStatus ? 'FAILED' : 'UPDATE',
        amount,
        TransactionError: transactionError,
      } as SNSMessage);
    } catch (error) {
      this.logger.error('Failed to publish status update', { error });
    }
  }

  private getStatusPriority(status: string): number {
    const priorities: Record<string, number> = {
      INTENT_CREATED: 1,
      INTENT_REQUIRES_PAYMENT_METHOD: 2,
      INTENT_REQUIRES_CONFIRMATION: 3,
      INTENT_REQUIRES_ACTION: 4,
      INTENT_PROCESSING: 5,
      INTENT_REQUIRES_CAPTURE: 6,
      INTENT_SUCCEEDED: 7,
      INTENT_FAILED: 8,
      INTENT_CANCELLED: 9,
      CHARGE_SUCCEEDED: 10,
      CHARGE_UPDATED: 11,
      CHARGE_FAILED: 12,
      CHARGE_REFUNDED: 13,
      CHARGE_REFUND_UPDATED: 14,
      REFUND_CREATED: 15,
      REFUND_UPDATED: 16,
      REFUND_FAILED: 17,
    };
    return priorities[status] || 0; // Default to 0 if status is unrecognized
  }

  private async updateRecordIfHigherStatus(
    key: { uniqueId: string },
    newStatus: string,
    transactionId: string,
    updateData: Record<string, unknown>
  ): Promise<void> {
    try {
      this.logger.info('Fetching latest status from Stripe');

      let latestStatus: string | null = null;

      if (newStatus.startsWith('INTENT')) {
        const paymentIntent = await this.stripeClient.paymentIntents.retrieve(
          key.uniqueId
        );
        latestStatus = `INTENT_${paymentIntent.status.toUpperCase()}`;
        this.logger.info('Latest status:', { latestStatus });
      } else if (
        newStatus.startsWith('CHARGE') ||
        newStatus.startsWith('REFUND')
      ) {
        const chargeOrRefund = await this.stripeClient.charges.retrieve(
          key.uniqueId
        );
        latestStatus = `CHARGE_${chargeOrRefund.status.toUpperCase()}`;
        this.logger.info('Latest status:', { latestStatus });
      }

      if (!latestStatus) {
        this.logger.warn(
          'Could not fetch latest status from Stripe, skipping update.'
        );
        return;
      }

      const currentPriority = this.getStatusPriority(latestStatus);
      const newPriority = this.getStatusPriority(newStatus);

      this.logger.info('Current status:', { currentPriority, newPriority });

      if (newPriority <= currentPriority) {
        this.logger.info(
          `Skipping update: latest status (${latestStatus}) has higher or equal priority.`
        );
        return;
      }

      await this.publishStatusUpdate(
        transactionId,
        updateData.status as string,
        updateData.amount as string,
        updateData
      );

      await this.dbService.updatePaymentRecord(
        { transactionId: transactionId },
        updateData
      );
      this.logger.info('Record updated successfully', { updateData });
    } catch (error) {
      this.logger.error('Failed to update record:', { error });
    }
  }

  private async handlePaymentEvent(
    eventObject: stripe.PaymentIntent | stripe.Charge | stripe.Refund,
    status: string
  ): Promise<void> {
    this.logger.info(`Processing event with status: ${status}`, eventObject);

    let uniqueId: string;

    if (eventObject.object === 'payment_intent') {
      // If it's a Charge or Refund, get the associated PaymentIntent ID
      uniqueId = eventObject.id as string;
      this.logger.info('PaymentIntent ID:', uniqueId);
    } else if (eventObject.object === 'charge') {
      // Otherwise, use the Charge or Refund ID
      this.logger.info('Charge', eventObject.id); // Charge or Refund Id
      uniqueId = eventObject.id;
    } else {
      // If it's a Refund, get the associated PaymentIntent ID
      uniqueId = eventObject.object as string;
      this.logger.info('Refund ID:');
    }
    const transactionId = eventObject?.metadata?.transactionId;
    await this.updateRecordIfHigherStatus(
      { uniqueId },
      status,
      transactionId as string,
      {
        status,
        refundId: 'refund' in eventObject ? eventObject.id : undefined,
        paymentResponse: eventObject,
      }
    );
  }

  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      this.logger.info('Received webhook event');
      await this.initialize();
      if (!event.headers['Stripe-Signature'] || !event.body)
        throw new Error('Invalid webhook request');
      const bodyBuffer = await this.getEventStream(event.body);

      const stripeEvent = this.stripeClient.webhooks.constructEvent(
        bodyBuffer,
        event.headers['Stripe-Signature'],
        this.signingSecret
      );
      this.logger.info('Processing Stripe event', { type: stripeEvent.type });

      const eventMapping: Record<string, string> = {
        'charge.succeeded': 'CHARGE_SUCCEEDED',
        'charge.updated': 'CHARGE_UPDATED',
        'charge.failed': 'CHARGE_FAILED',
        'charge.refunded': 'CHARGE_REFUNDED',
        'charge.refund.updated': 'CHARGE_REFUND_UPDATED',
        'payment_intent.succeeded': 'INTENT_SUCCEEDED',
        'payment_intent.created': 'INTENT_CREATED',
        'payment_intent.payment_failed': 'INTENT_FAILED',
        'payment_intent.requires_action': 'INTENT_REQUIRES_ACTION',
        'payment_intent.requires_confirmation': 'INTENT_REQUIRES_CONFIRMATION',
        'payment_intent.requires_capture': 'INTENT_REQUIRES_CAPTURE',
        'payment_intent.requires_payment_method':
          'INTENT_REQUIRES_PAYMENT_METHOD',
        'payment_intent.canceled': 'INTENT_CANCELLED',
        'payment_intent.processing': 'INTENT_PROCESSING',
        'refund.created': 'REFUND_CREATED',
        'refund.updated': 'REFUND_UPDATED',
        'refund.failed': 'REFUND_FAILED',
      };

      const status = eventMapping[stripeEvent.type];
      if (status)
        if (status)
          await this.handlePaymentEvent(
            stripeEvent.data.object as
              | stripe.PaymentIntent
              | stripe.Charge
              | stripe.Refund,
            status
          );
        else this.logger.warn('Unhandled event type', stripeEvent.type);

      return {
        statusCode: 200,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ received: true }),
      };
    } catch (error) {
      this.logger.error('Error processing webhook', { error });
      return {
        statusCode: 400,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ error: 'Webhook processing failed' }),
      };
    }
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> =>
  new StripeWebhookService().processWebhook(event);
