import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import stripe from 'stripe';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';

export class StripeWebhookService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private stripeClient: stripe;

  private signingSecret: string;

  private readonly dbService: DynamoDBService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.logger.info('init()');
  }

  public async initialize(): Promise<void> {
    const stripeSecret = await this.secretsManagerService.getSecret(
      process.env.STRIPE_API_SECRET as string
    );
    this.stripeClient = new stripe(stripeSecret.apiKey);
    this.signingSecret = stripeSecret.signingSecret;
  }

  /**
   * Returns a numeric priority for a given status.
   * Higher numbers mean a later (more final) state.
   */
  private getStatusPriority(status: string): number {
    switch (status) {
      case 'PENDING':
        return 1;
      case 'INTENT_CREATED':
        return 2;
      case 'INTENT_PROCESSING':
        return 3;
      case 'INTENT_SUCCEEDED':
        return 4;
      case 'INTENT_REQUIRES_ACTION':
        return 5;
      case 'CHARGE_UPDATED':
        return 6;
      case 'CHARGE_SUCCEEDED':
        return 7;
      case 'INTENT_CANCELLED':
        return 8;
      case 'INTENT_FAILED':
        return 9;
      case 'REFUND_CREATED':
        return 10;
      case 'REFUND_UPDATED':
        return 11;
      case 'REFUND_FAILED':
        return 12;
      default:
        return 0;
    }
  }

  /**
   * Helper method that retrieves the current record and only updates it
   * if the new event's status is higher than the existing one.
   */
  private async updateRecordIfHigherStatus(
    key: { transactionId: string },
    newStatus: string,
    updateData: Record<string, unknown>
  ): Promise<void> {
    try {
      this.logger.info('updateRecordIfHigherStatus');
      const currentRecord = await this.dbService.getItem(key);
      this.logger.info('currentRecord', currentRecord);
      if (currentRecord && currentRecord?.Item?.status) {
        const currentPriority = this.getStatusPriority(
          currentRecord?.Item?.status
        );
        const newPriority = this.getStatusPriority(newStatus);
        if (newPriority <= currentPriority) {
          this.logger.info(
            `Skipping update for transaction ${key.transactionId}: current status (${currentRecord?.Item?.status}) has higher or equal priority than new status (${newStatus}).`
          );
          return;
        }
      }
      const updatedRecord = await this.dbService.updatePaymentRecord(
        key,
        updateData
      );
      this.logger.info('Record updated successfully:', updatedRecord);
    } catch (error) {
      this.logger.error('Failed to update record:', { error });
    }
  }

  private async handlePaymentEvent(
    paymentIntent: stripe.PaymentIntent | stripe.Charge | stripe.Refund,
    status: string
  ): Promise<void> {
    this.logger.info(`Processing event with status: ${status}`, paymentIntent);

    const transactionId =
      'payment_intent' in paymentIntent
        ? (paymentIntent.payment_intent as string)
        : paymentIntent.id;

    const key = { transactionId };
    this.logger.info('key', key);

    const updateData = {
      status,
      paymentProviderResponse: paymentIntent,
    };

    await this.updateRecordIfHigherStatus(key, updateData.status, updateData);
  }

  public async processWebhook(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    try {
      this.logger.info('Received event:', event);
      await this.initialize();

      if (!event.headers['Stripe-Signature']) {
        throw new Error('No Stripe signature found in headers');
      }

      if (!event.body) {
        throw new Error('No event body received');
      }

      const stripeEvent = this.stripeClient.webhooks.constructEvent(
        event.body as string,
        event.headers['Stripe-Signature'] as string,
        this.signingSecret
      );

      this.logger.info('Processing Stripe webhook', { stripeEvent });
      switch (stripeEvent.type) {
        case 'charge.succeeded':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.Charge,
            'CHARGE_SUCCEEDED'
          );
          break;
        case 'charge.updated':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.Charge,
            'CHARGE_UPDATED'
          );
          break;
        case 'payment_intent.succeeded':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.PaymentIntent,
            'INTENT_SUCCEEDED'
          );
          break;
        case 'payment_intent.created':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.PaymentIntent,
            'INTENT_CREATED'
          );
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.PaymentIntent,
            'INTENT_FAILED'
          );
          break;
        case 'payment_intent.requires_action':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.PaymentIntent,
            'INTENT_REQUIRES_ACTION'
          );
          break;
        case 'payment_intent.canceled':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.PaymentIntent,
            'INTENT_CANCELLED'
          );
          break;
        case 'payment_intent.processing':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.PaymentIntent,
            'INTENT_PROCESSING'
          );
          break;
        case 'refund.created':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.Refund,
            'REFUND_CREATED'
          );
          break;
        case 'refund.updated':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.Refund,
            'REFUND_UPDATED'
          );
          break;
        case 'refund.failed':
          await this.handlePaymentEvent(
            stripeEvent.data.object as stripe.Refund,
            'REFUND_FAILED'
          );
          break;
        default:
          this.logger.warn('Unhandled event type', stripeEvent.type);
      }

      this.logger.info('Webhook event processed successfully', {
        type: stripeEvent.type,
        id: stripeEvent.id,
      });

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
): Promise<APIGatewayProxyResult> => {
  const service = new StripeWebhookService();
  return service.processWebhook(event);
};
