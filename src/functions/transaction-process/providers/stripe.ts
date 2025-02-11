import { Stripe } from 'stripe';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { CardData } from '../../../model';
import { CreatePaymentRecord } from '../../../model';

const PAYQAM_FEE_PERCENTAGE = parseFloat(
  process.env.PAYQAM_FEE_PERCENTAGE || '2.5'
);

export class CardPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  private stripeClient: Stripe;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.logger.info('init()');
  }

  /**
   * Initializes the Stripe client with API key from Secrets Manager
   */
  private async initStripeClient(): Promise<void> {
    if (!this.stripeClient) {
      const stripeSecret = await this.secretsManagerService.getSecret(
        process.env.STRIPE_API_SECRET as string
      );
      this.stripeClient = new Stripe(stripeSecret.apiKey, {
        apiVersion: '2025-01-27.acacia',
      });
    }
  }

  /**
   * Calculates PayQAM's fee and the merchant's settlement amount
   *
   * @param amount - Original payment amount
   * @returns Object containing fee and settlement amounts
   */
  private calculateFeeAndSettlement(amount: number): {
    fee: number;
    settlementAmount: number;
  } {
    const feePercentage = PAYQAM_FEE_PERCENTAGE / 100;
    const fee = Math.round(amount * feePercentage); // Round to nearest cent
    return {
      fee,
      settlementAmount: amount - fee,
    };
  }

  public async processCardPayment(
    amount: number,
    cardData: CardData,
    metaData?: Record<string, never>
  ): Promise<string> {
    this.logger.info('Processing card payment', {
      amount,
      cardType: cardData.cardName,
      hasDestinationId: !!cardData.destinationId,
    });

    await this.initStripeClient();

    const { fee, settlementAmount } = this.calculateFeeAndSettlement(amount);

    this.logger.info('Calculated payment amounts', {
      originalAmount: amount,
      fee,
      settlementAmount,
      feePercentage: PAYQAM_FEE_PERCENTAGE,
    });

    const paymentIntent = await this.stripeClient.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method: cardData.id,
      confirm: true,
      transfer_data: {
        amount: settlementAmount,
        destination: cardData.destinationId,
      },
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });

    this.logger.info('Payment intent created', {
      paymentIntentId: paymentIntent?.id,
      status: paymentIntent?.status,
      settlementAmount,
    });

    const record: CreatePaymentRecord = {
      transactionId: paymentIntent.id,
      amount,
      paymentMethod: 'CARD',
      createdOn: Math.floor(Date.now() / 1000),
      status: paymentIntent.status,
      paymentProviderResponse: paymentIntent as unknown as Record<
        string,
        never
      >,
      metaData,
      fee,
      settlementAmount,
      currency: 'usd',
    };

    try {
      await this.dbService.createPaymentRecord(record);
      this.logger.info('Payment record created in DynamoDB', {
        transactionId: record.transactionId,
        status: record.status,
        amount: record.amount,
        fee: record.fee,
      });
    } catch (error) {
      this.logger.error('Error creating payment record', {
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId: record.transactionId,
      });
      throw error;
    }
    return record.transactionId;
  }
}
