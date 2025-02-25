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
      amount,
      paymentMethod,
      cardData,
      customerPhone,
      metaData,
      merchantId,
      merchantMobileNo,
      transactionType,
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
          amount,
          cardData,
          transactionType as string,
          merchantId as string,
          metaData
        );

      case 'MTN':
        if (!customerPhone) {
          throw new EnhancedError(
            'MISSING_PHONE',
            ErrorCategory.VALIDATION_ERROR,
            'Missing customer phone number for MTN payment'
          );
        }
        if (!merchantId || !merchantMobileNo) {
          throw new EnhancedError(
            'MISSING_MERCHANT_INFO',
            ErrorCategory.VALIDATION_ERROR,
            'Missing merchant information for MTN payment'
          );
        }
        this.logger.info('Processing MTN payment', {
          amount,
          customerPhone,
          merchantId,
          merchantMobileNo,
        });
        return this.mtnPaymentService.processPayment(
          amount,
          customerPhone,
          merchantId,
          merchantMobileNo,
          metaData
        );

      case 'ORANGE':
        if (!customerPhone) {
          throw new EnhancedError(
            'MISSING_PHONE',
            ErrorCategory.VALIDATION_ERROR,
            'Missing customer phone number for Orange Money payment'
          );
        }
        if (!merchantId) {
          throw new EnhancedError(
            'MISSING_MERCHANT_ID',
            ErrorCategory.VALIDATION_ERROR,
            'Missing merchant ID for Orange Money payment'
          );
        }
        if (!merchantMobileNo) {
          throw new EnhancedError(
            'MISSING_MERCHANT_MOBILE',
            ErrorCategory.VALIDATION_ERROR,
            'Missing merchant mobile number for Orange Money payment'
          );
        }
        this.logger.info('Processing Orange Money payment');
        return this.orangePaymentService.processPayment(
          amount,
          customerPhone,
          merchantId,
          merchantMobileNo,
          metaData
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
