import { Logger } from '@mu-ts/logger';
import {
  CardPaymentService,
  MtnPaymentService,
  OrangePaymentService,
} from './providers';
import { PaymentRequest } from '../../model';
import { EnhancedError, ErrorCategory } from '../../../utils/errorHandler';

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

  async processPayment(
    transaction: PaymentRequest
  ): Promise<{ transactionId: string; status: string } | string> {
    const {
      transactionId,
      amount,
      paymentMethod,
      currency,
      cardData,
      customerPhone,
      metaData,
      merchantId,
      merchantMobileNo,
      transactionType,
      payerMessage,
      payeeNote,
    } = transaction;
    switch (paymentMethod) {
      case 'CARD':
        if (!cardData) {
          throw new EnhancedError(
            'MISSING_CARD_DATA',
            ErrorCategory.VALIDATION_ERROR,
            'Missing card data for card payment'
          );
        }
        this.logger.info('Processing card payment', { amount, cardData });
        return this.cardPaymentService.processCardPayment(
          amount as number,
          cardData,
          transactionType as string,
          merchantId as string,
          currency as string,
          merchantMobileNo as string,
          customerPhone,
          metaData
        );

      case 'MTN':
        this.logger.info('Processing MTN payment', {
          amount,
          customerPhone,
          merchantId,
          merchantMobileNo,
        });
        return this.mtnPaymentService.processPayment(
          transactionId as string,
          amount as number,
          transactionType as string,
          customerPhone as string,
          merchantId as string,
          merchantMobileNo as string,
          currency as string,
          payerMessage as string,
          payeeNote as string,
          metaData
        );

      case 'ORANGE':
        this.logger.info('Processing Orange Money payment', {
          amount,
          customerPhone,
          merchantId,
          merchantMobileNo,
          transactionType,
          transactionId,
        });
        return this.orangePaymentService.processPayment(
          amount as number,
          customerPhone as string,
          merchantId as string,
          merchantMobileNo as string,
          metaData,
          transactionType,
          currency,
          transactionId
        );

      default:
        throw new EnhancedError(
          'UNSUPPORTED_PAYMENT_METHOD',
          ErrorCategory.VALIDATION_ERROR,
          `Unsupported payment method: ${paymentMethod}`
        );
    }
  }
}
