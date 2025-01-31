import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import stripe from 'stripe';
import { SecretsManagerService } from '../../../services/secretsManagerService';

export class StripeWebhookService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private stripeClient: stripe;

  private signingSecret: string;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
  }

  public async initialize(): Promise<void> {
    const stripeSecret = await this.secretsManagerService.getSecret(
      process.env.STRIPE_API_SECRET as string
    );
    this.stripeClient = new stripe(stripeSecret.apiKey);
    this.signingSecret = stripeSecret.signingSecret;
  }

  private async handlePaymentIntentCreated(
    paymentIntent: stripe.PaymentIntent
  ): Promise<void> {
    this.logger.info('Payment intent created', paymentIntent);
    // TODO: Implement handling logic
  }

  private async handlePaymentIntentSucceeded(
    paymentIntent: stripe.PaymentIntent
  ): Promise<void> {
    this.logger.info('Payment intent succeeded', paymentIntent);
    // TODO: Implement handling logic
  }

  private async handlePaymentIntentFailed(
    paymentIntent: stripe.PaymentIntent
  ): Promise<void> {
    this.logger.error('Payment intent failed', paymentIntent);
    // TODO: Implement handling logic
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

      const stripeEvent = this.stripeClient.webhooks.constructEvent(
        event.body as string,
        event.headers['Stripe-Signature'] as string,
        this.signingSecret
      );

      this.logger.info('Processing Stripe webhook', { stripeEvent });
      if (!event.body) {
        throw new Error('No event body received');
      }

      switch (stripeEvent.type) {
        case 'payment_intent.created':
          await this.handlePaymentIntentCreated(
            stripeEvent.data.object as stripe.PaymentIntent
          );
          break;
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(
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
