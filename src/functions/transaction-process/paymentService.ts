import { Logger } from '@mu-ts/logger';
import {
  CardPaymentService,
  MtnPaymentService,
  OrangePaymentService,
} from './providers';

interface CardData {
  id: string;
  cardName: string;
  destinationId: string;
}

interface PaymentRequest {
  amount: number;
  paymentMethod: string;
  cardData?: CardData;
  customerPhone?: string;
}

export class PaymentService {
  private readonly logger: Logger;

  private readonly cardPaymentService: CardPaymentService;

  private readonly orangePaymentService: OrangePaymentService;

  private readonly mtnPaymentService: MtnPaymentService;

  constructor(logger: Logger) {
    this.logger = logger;
    this.cardPaymentService = new CardPaymentService();
    this.mtnPaymentService = new MtnPaymentService();
    this.orangePaymentService = new OrangePaymentService();
  }

  async processPayment(transaction: PaymentRequest): Promise<string> {
    const { amount, paymentMethod, cardData, customerPhone } = transaction;

    switch (paymentMethod) {
      case 'CARD':
        if (!cardData) throw new Error('Missing card data for card payment');
        this.logger.info('Processing card payment', { amount, cardData });
        return this.cardPaymentService.processCardPayment(amount, cardData);

      case 'MOMO':
        if (!customerPhone)
          throw new Error(
            'Missing customer phone number for MTN Mobile Money payment'
          );
        this.logger.info('Processing MTN Mobile Money payment');
        return this.mtnPaymentService.processPayment(amount, customerPhone);

      case 'ORANGE':
        if (!customerPhone)
          throw new Error(
            'Missing customer phone number for Orange Money payment'
          );
        this.logger.info('Processing Orange Money payment');
        return this.orangePaymentService.processPayment(amount, customerPhone);

      default:
        throw new Error(`Unsupported payment method: ${paymentMethod}`);
    }
  }
}
