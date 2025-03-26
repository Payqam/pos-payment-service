import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import stripe from 'stripe';
import { SecretsManagerService } from '../../../../services/secretsManagerService';
import { Readable } from 'stream';
import { StripeWebhookService } from '../handler';
import { StripeTransactionStatus } from '../../../../model';

export class WebhookProcessor {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private stripeClient!: stripe;

  private signingSecret!: string;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.logger.info('WebhookProcessor initialized');
  }

  private async initialize(): Promise<void> {
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
      this.logger.info('Processing Stripe event', '-->', { stripeEvent });
      this.logger.info('Processing Stripe event', { type: stripeEvent.type });

      const eventMapping: Record<string, StripeTransactionStatus> = {
        'charge.succeeded': 'CHARGE_SUCCEEDED',
        'charge.updated': 'CHARGE_UPDATE_SUCCEEDED',
        'charge.failed': 'CHARGE_FAILED',
        'charge.refunded': 'CHARGE_REFUND_SUCCEEDED',
        'charge.refund.updated': 'REFUND_CHARGE_UPDATE_SUCCEEDED',
        'payment_intent.succeeded': 'INTENT_SUCCEEDED',
        'payment_intent.created': 'INTENT_CREATE_SUCCEEDED',
        'payment_intent.payment_failed': 'INTENT_FAILED',
        'payment_intent.requires_action': 'INTENT_REQUIRES_ACTION',
        'payment_intent.requires_confirmation': 'INTENT_REQUIRES_CONFIRMATION',
        'payment_intent.requires_capture': 'INTENT_REQUIRES_CAPTURE',
        'payment_intent.requires_payment_method':
          'INTENT_REQUIRES_PAYMENT_METHOD',
        'payment_intent.canceled': 'INTENT_CANCELLED',
        'payment_intent.processing': 'INTENT_PROCESSING',
        'refund.created': 'REFUND_CREATE_SUCCEEDED',
        'refund.updated': 'REFUND_UPDATE_SUCCEEDED',
        'refund.failed': 'REFUND_FAILED',
        'transfer.created': 'TRANSFER_CREATE_SUCCEEDED',
        'transfer.reversed': 'TRANSFER_REVERSED_SUCCEEDED',
        'transfer.failed': 'TRANSFER_FAILED',
      };

      const status = eventMapping[stripeEvent.type];
      if (status) {
        const stripeWebhookService = new StripeWebhookService();
        await stripeWebhookService.initialize();
        await stripeWebhookService.handlePaymentEvent(
          stripeEvent.data.object as
            | stripe.PaymentIntent
            | stripe.Charge
            | stripe.Refund,
          status
        );
      } else {
        this.logger.warn('Unhandled event type', stripeEvent.type);
      }

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

export const processWebhook = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return new WebhookProcessor().processWebhook(event);
};
