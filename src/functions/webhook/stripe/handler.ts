import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import stripe from 'stripe';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';

export class StripeWebhookService {
  private readonly logger: Logger = LoggerService.named(this.constructor.name);

  private readonly secretsManagerService = new SecretsManagerService();

  private readonly dbService = new DynamoDBService();

  private readonly snsService = SNSService.getInstance();

  private stripeClient!: stripe;

  private signingSecret!: string;

  constructor() {
    this.logger.info('StripeWebhookService initialized');
  }

  public async initialize(): Promise<void> {
    const stripeSecret = await this.secretsManagerService.getSecret(
      process.env.STRIPE_API_SECRET as string
    );
    this.stripeClient = new stripe(stripeSecret.apiKey);
    this.signingSecret = stripeSecret.signingSecret;
  }

  private async publishStatusUpdate(
    transactionId: string,
    status: string,
    amount: string,
    updateData: Record<string, unknown>
  ): Promise<void> {
    try {
      const paymentProviderResponse = updateData.paymentProviderResponse as {
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
        if (paymentProviderResponse.last_payment_error) {
          // Handle INTENT_FAILED structure
          transactionError = {
            ErrorCode: paymentProviderResponse.last_payment_error.code,
            ErrorMessage: paymentProviderResponse.last_payment_error.message,
            ErrorType: paymentProviderResponse.last_payment_error.type,
            ErrorSource: 'POS',
          };
        } else if (
          paymentProviderResponse.failure_code &&
          paymentProviderResponse.failure_message
        ) {
          // Handle CHARGE_FAILED structure
          transactionError = {
            ErrorCode: paymentProviderResponse.failure_code,
            ErrorMessage: paymentProviderResponse.failure_message,
            ErrorType: paymentProviderResponse.outcome?.type,
            ErrorSource: 'POS',
          };
        }
      }

      await this.snsService.publish(process.env.TRANSACTION_STATUS_TOPIC_ARN!, {
        transactionId,
        status,
        type: isFailedStatus ? 'FAILED' : 'UPDATE',
        amount,
        TransactionError: transactionError,
      });
    } catch (error) {
      this.logger.error('Failed to publish status update', { error });
    }
  }

  private getStatusPriority(status: string): number {
    const priorities: Record<string, number> = {
      INTENT_CREATED: 1,
      INTENT_REQUIRES_ACTION: 2,
      INTENT_PROCESSING: 3,
      INTENT_SUCCEEDED: 4,
      CHARGE_SUCCEEDED: 5,
      CHARGE_UPDATED: 6,
      CHARGE_FAILED: 7,
      INTENT_FAILED: 8,
      INTENT_CANCELLED: 9,
      REFUND_CREATED: 10,
      REFUND_UPDATED: 11,
      REFUND_FAILED: 12,
      CHARGE_REFUNDED: 13,
      CHARGE_REFUND_UPDATED: 14,
    };
    return priorities[status] || 0;
  }

  private async updateRecordIfHigherStatus(
    key: { uniqueId: string },
    newStatus: string,
    updateData: Record<string, unknown>
  ): Promise<void> {
    try {
      this.logger.info('Checking record status before update');
      const queryResult = await this.dbService.queryByGSI(key, 'GSI3');
      const currentRecord = queryResult.Items?.[0];
      const transactionId = currentRecord?.transactionId;

      if (currentRecord?.Item?.status) {
        const currentPriority = this.getStatusPriority(
          currentRecord.Item.status
        );
        const newPriority = this.getStatusPriority(newStatus);
        if (newPriority <= currentPriority) {
          this.logger.info(
            `Skipping update: current status (${currentRecord.Item.status}) has higher or equal priority.`
          );
          return;
        }
      }
      await this.publishStatusUpdate(
        transactionId,
        updateData.status as string,
        updateData.amount as string,
        updateData
      );
      await this.dbService.updatePaymentRecord({ transactionId }, updateData);
      this.logger.info('Record updated successfully');
    } catch (error) {
      this.logger.error('Failed to update record:', { error });
    }
  }

  private async handlePaymentEvent(
    paymentIntent: stripe.PaymentIntent | stripe.Charge | stripe.Refund,
    status: string
  ): Promise<void> {
    this.logger.info(`Processing event with status: ${status}`, paymentIntent);
    const uniqueId =
      'payment_intent' in paymentIntent
        ? (paymentIntent.payment_intent as string)
        : paymentIntent.id;
    await this.updateRecordIfHigherStatus({ uniqueId }, status, {
      status,
      refundId: 'refund' in paymentIntent ? paymentIntent.id : undefined,
      paymentProviderResponse: paymentIntent,
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

      const stripeEvent = this.stripeClient.webhooks.constructEvent(
        event.body,
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
