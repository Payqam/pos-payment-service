import stripe from 'stripe';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';

interface CardData {
  id: string;
  cardName: string;
  destinationId: string;
}

export class CardPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.logger.info('CardPaymentService initialized');
  }

  public async processCardPayment(
    amount: number,
    cardData: CardData
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
    return 'Card payment successful';
  }
}
