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
      case 'INTENT_SUCCEEDED':
        return 3;
      case 'CHARGE_UPDATED':
        return 4;
      case 'CHARGE_SUCCEEDED':
        return 5;
      case 'FAILED':
        return 0;
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

  private async handlePaymentIntentUpdated(
    charge: stripe.Charge
  ): Promise<void> {
    this.logger.info('Payment intent updated', charge);
    const key = { transactionId: charge.payment_intent as string };
    this.logger.info('key', key);

    const updateData = {
      status: 'CHARGE_UPDATED',
      paymentProviderResponse: charge,
    };

    await this.updateRecordIfHigherStatus(key, updateData.status, updateData);
  }

  private async handlePaymentIntentSucceeded(
    paymentIntent: stripe.PaymentIntent
  ): Promise<void> {
    this.logger.info('Payment intent succeeded', paymentIntent);
    const key = { transactionId: paymentIntent.id as string };
    this.logger.info('key', key);

    const updateData = {
      status: 'INTENT_SUCCEEDED',
      paymentProviderResponse: paymentIntent,
    };

    await this.updateRecordIfHigherStatus(key, updateData.status, updateData);
  }

  private async handlePaymentIntentCreated(
    paymentIntent: stripe.PaymentIntent
  ): Promise<void> {
    this.logger.info('Payment intent created', paymentIntent);
    const key = { transactionId: paymentIntent.id };
    this.logger.info('key', key);

    const updateData = {
      status: 'INTENT_CREATED',
      paymentProviderResponse: paymentIntent,
    };

    await this.updateRecordIfHigherStatus(key, updateData.status, updateData);
  }

  private async handleChargeSucceeded(charge: stripe.Charge): Promise<void> {
    this.logger.info('Charge succeeded', charge);
    const key = { transactionId: charge.payment_intent as string };
    this.logger.info('key', key);

    const updateData = {
      status: 'CHARGE_SUCCEEDED',
      paymentProviderResponse: charge,
    };

    await this.updateRecordIfHigherStatus(key, updateData.status, updateData);
  }

  private async handlePaymentIntentFailed(
    paymentIntent: stripe.PaymentIntent
  ): Promise<void> {
    this.logger.error('Payment intent failed', paymentIntent);
    const key = { transactionId: paymentIntent.payment_method as string };
    this.logger.info('key', key);

    const updateData = {
      status: 'FAILED',
      amount: paymentIntent.amount,
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
          await this.handleChargeSucceeded(
            stripeEvent.data.object as stripe.Charge
          );
          break;
        case 'charge.updated':
          await this.handlePaymentIntentUpdated(
            stripeEvent.data.object as stripe.Charge
          );
          break;
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(
            stripeEvent.data.object as stripe.PaymentIntent
          );
          break;
        case 'payment_intent.created':
          await this.handlePaymentIntentCreated(
            stripeEvent.data.object as stripe.PaymentIntent
          );
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(
            stripeEvent.data.object as stripe.PaymentIntent
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
