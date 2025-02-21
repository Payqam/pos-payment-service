import stripe from 'stripe';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { CardData } from '../../../model';
import { CacheService } from '../../../services/cacheService';
import { SNSService } from '../../../services/snsService';

export class CardPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  private readonly cacheService: CacheService;

  private readonly snsService: SNSService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.cacheService = new CacheService();
    this.snsService = SNSService.getInstance();
    this.logger.info('init()');
  }

  public async processCardPayment(
    amount: number,
    cardData: CardData,
    transactionType: string,
    merchantId: string,
    metaData?: Record<string, string>
  ): Promise<{ transactionId: string; status: string }> {
    this.logger.info('Processing card payment', {
      amount,
      cardData,
      transactionType,
    });

    const stripeSecret = await this.secretsManagerService.getSecret(
      process.env.STRIPE_API_SECRET as string
    );
    const stripeClient = new stripe(stripeSecret.apiKey);

    switch (transactionType) {
      case 'CHARGE': {
        try {
          const feePercentage = 0.02;
          const feeAmount = Math.floor(amount * feePercentage);
          const transferAmount = Math.max(amount - feeAmount, 0);

          const paymentIntent = await stripeClient.paymentIntents.create({
            amount,
            currency: cardData.currency as string,
            payment_method: cardData.paymentMethodId,
            confirm: true,
            transfer_data: {
              amount: transferAmount,
              destination: cardData.destinationId as string,
            },
            automatic_payment_methods: {
              enabled: true,
              allow_redirects: 'never',
            },
          });

          this.logger.info('Payment intent created', paymentIntent);
          const record = {
            transactionId: paymentIntent?.id as string,
            merchantId: merchantId,
            amount,
            paymentMethod: 'CARD',
            createdOn: Math.floor(Date.now() / 1000),
            status: paymentIntent.status,
            paymentProviderResponse: paymentIntent,
            transactionType: 'CHARGE',
            metaData: metaData,
            fee: feeAmount,
          };
          await this.dbService.createPaymentRecord(record);
          this.logger.info('Payment record created in DynamoDB', record);
          // Only cache if enabled
          if (process.env.ENABLE_CACHE === 'true') {
            const key = `payment:${record.transactionId}`;
            await this.cacheService.setValue(key, record, 3600);
            this.logger.info('Payment record stored in Redis', { key });
          }await this.snsService.publish(
            process.env.TRANSACTION_STATUS_TOPIC_ARN!,
            {
              transactionId: paymentIntent.id,
              status: paymentIntent.status,
              type: 'CREATE',
              amount,
              merchantId: merchantId,
              transactionType: 'CHARGE',
              metaData: metaData,
              fee: feeAmount,
              createdOn: Math.floor(Date.now() / 1000),
            }
          );
          return {
            transactionId: paymentIntent.id,
            status: paymentIntent.status,
          };
        } catch (error) {
          this.logger.error('Error creating payment record', error);
          throw error;
        }
      }

      case 'REFUND': {
        try {
          const refund = await stripeClient.refunds.create({
            payment_intent: cardData.paymentIntentId,
            amount: amount ? amount : undefined,
            reason: cardData.reason as stripe.RefundCreateParams.Reason,
            reverse_transfer: cardData.reverse_transfer,
          });

          this.logger.info('Refund processed', refund);
          const record = {
            transactionId: refund?.id as string,
            amount,
            paymentMethod: 'CARD',
            createdOn: Math.floor(Date.now() / 1000),
            status: refund.status as string,
            paymentProviderResponse: refund,
            metaData: metaData,
            transactionType: 'REFUND',
          };
          await this.dbService.createPaymentRecord(record);
          await this.snsService.publish(
            process.env.TRANSACTION_STATUS_TOPIC_ARN!,
            {
              transactionId: refund.id,
              status: refund.status,
              type: 'CREATE',
              amount,
              merchantId: merchantId,
              transactionType: 'CHARGE',
              metaData: metaData,
            }
          );
          return {
            transactionId: refund.id,
            status: refund.status as string,
          };
        } catch (error) {
          this.logger.error('Error processing refund', error);
          throw error;
        }
      }

      default:
        throw new Error(`Unsupported transaction type: ${transactionType}`);
    }
  }
}
