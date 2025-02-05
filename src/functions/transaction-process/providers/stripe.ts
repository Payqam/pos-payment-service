import stripe from 'stripe';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { CardData } from '../../../model';

export class CardPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.logger.info('init()');
  }

  public async processCardPayment(
    amount: number,
    cardData: CardData,
    metaData?: Record<string, string>
  ): Promise<string> {
    this.logger.info('Processing card payment', { amount, cardData });

    const stripeSecret = await this.secretsManagerService.getSecret(
      process.env.STRIPE_API_SECRET as string
    );
    const stripeClient = new stripe(stripeSecret.apiKey);

    const feeAmount = ['visa', 'mastercard', 'amex'].includes(cardData.cardName)
      ? 250
      : 19;
    const transferAmount = Math.max(amount - feeAmount, 0);

    const paymentIntent = await stripeClient.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method: cardData.id,
      confirm: true,
      transfer_data: {
        amount: transferAmount,
        destination: cardData.destinationId,
      },
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });

    this.logger.info('Payment intent created', paymentIntent);
    const record = {
      transactionId: paymentIntent?.id as string,
      amount,
      paymentMethod: 'CARD',
      createdOn: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      paymentProviderResponse: paymentIntent,
      metaData: metaData,
      fee: feeAmount,
    };

    try {
      await this.dbService.createPaymentRecord(record);
      this.logger.info('Payment record created in DynamoDB', record);
    } catch (error) {
      this.logger.error('Error creating payment record', error);
      throw error;
    }
    return 'Card payment successful';
  }
}
