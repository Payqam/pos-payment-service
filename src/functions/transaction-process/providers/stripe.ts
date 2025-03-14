import stripe from 'stripe';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { CardData, CreatePaymentRecord } from '../../../model';
// import { CacheService } from '../../../services/cacheService';
import { SNSService } from '../../../services/snsService';
import { v4 as uuidv4 } from 'uuid';

export class CardPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  // private readonly cacheService: CacheService;

  private readonly snsService: SNSService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    // if (process.env.ENABLE_CACHE === 'true') {
    //   this.cacheService = new CacheService();
    // }
    this.snsService = SNSService.getInstance();
    this.logger.info('init()');
  }

  public async processCardPayment(
    amount: number,
    cardData: CardData,
    transactionType: string,
    merchantId: string,
    currency: string,
    customerPhone?: string,
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
    const dateTime = new Date().toISOString();

    switch (transactionType) {
      case 'CHARGE': {
        try {
          const transactionId = uuidv4();
          const feePercentage = 0.1;
          const feeAmount = Math.floor(amount * feePercentage);
          const transferAmount = Math.max(amount - feeAmount, 0);

          this.logger.info('Creating payment intent', {
            transferAmount,
            feeAmount,
            amount,
          });

          let paymentIntent;
          try {
            paymentIntent = await stripeClient.paymentIntents.create({
              amount,
              currency: currency,
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
              metadata: {
                transactionId: transactionId,
              },
            });
          } catch (paymentError: unknown) {
            if (paymentError instanceof stripe.errors.StripeError) {
              this.logger.error('Error creating payment intent', paymentError);

              const failedRecord: CreatePaymentRecord = {
                transactionId,
                merchantId,
                amount,
                paymentMethod: 'CARD',
                status: 'FAILED',
                paymentResponse: paymentError.raw as Record<string, unknown>,
                transactionType: 'CHARGE',
                metaData,
                fee: feeAmount,
                uniqueId: paymentError.payment_intent?.id as string,
                GSI1SK: Math.floor(new Date(dateTime).getTime() / 1000),
                GSI2SK: Math.floor(new Date(dateTime).getTime() / 1000),
                // exchangeRate: 'N/A',
                // processingFee: 'N/A',
                // netAmount: 'N/A',
                // externalTransactionId: 'N/A',
              };
              this.logger.info(
                'Failed payment record created in DynamoDB',
                failedRecord
              );
              await this.snsService.publish(
                process.env.TRANSACTION_STATUS_TOPIC_ARN!,
                {
                  transactionId,
                  paymentMethod: 'Stripe',
                  status: 'FAILED',
                  type: 'CREATE',
                  amount,
                  merchantId,
                  transactionType: 'CHARGE',
                  metaData,
                  fee: feeAmount,
                  createdOn: dateTime,
                  customerPhone,
                  currency: currency,
                  // exchangeRate: 'exchangeRate',
                  // processingFee: 'processingFee',
                  // netAmount: 'netAmount',
                  // externalTransactionId: 'externalTransactionId',
                }
              );
              await this.dbService.createPaymentRecord(failedRecord);
              this.logger.info(
                'Failed payment record created in DynamoDB',
                failedRecord
              );

              throw paymentError;
            }
          }
          this.logger.info('Payment intent created', paymentIntent);

          const record: CreatePaymentRecord = {
            transactionId,
            merchantId,
            amount,
            paymentMethod: 'CARD',
            status: paymentIntent?.status as string,
            paymentResponse: paymentIntent,
            transactionType: 'CHARGE',
            metaData,
            fee: feeAmount,
            uniqueId: paymentIntent?.id as string,
            GSI1SK: Math.floor(new Date(dateTime).getTime() / 1000),
            GSI2SK: Math.floor(new Date(dateTime).getTime() / 1000),
            // exchangeRate: 'exchangeRate',
            // processingFee: 'processingFee',
            // netAmount: 'netAmount',
            // externalTransactionId: 'externalTransactionId',
          };
          await this.dbService.createPaymentRecord(record);
          this.logger.info('Payment record created in DynamoDB', record);

          // if (process.env.ENABLE_CACHE === 'true') {
          //   const key = `payment:${record.transactionId}`;
          //   this.logger.info('Payment record stored in Redis', { key });
          // }

          await this.snsService.publish(
            process.env.TRANSACTION_STATUS_TOPIC_ARN!,
            {
              transactionId,
              paymentMethod: 'Stripe',
              status: paymentIntent?.status,
              type: 'CREATE',
              amount,
              merchantId,
              transactionType: 'CHARGE',
              metaData,
              fee: feeAmount,
              createdOn: dateTime,
              customerPhone,
              currency: currency,
              // exchangeRate: 'exchangeRate',
              // processingFee: 'processingFee',
              // netAmount: 'netAmount',
              // externalTransactionId: 'externalTransactionId',
            }
          );

          return {
            transactionId,
            status: paymentIntent?.status as string,
          };
        } catch (error) {
          this.logger.error('Error processing charge', error);
          throw error;
        }
      }

      case 'REFUND': {
        try {
          const queryResult = await this.dbService.queryByGSI(
            { uniqueId: cardData.paymentIntentId as string },
            'GSI3'
          );
          const currentRecord = queryResult.Items?.[0];
          const transactionId = currentRecord?.transactionId;
          let refund;
          try {
            refund = await stripeClient.refunds.create({
              payment_intent: cardData.paymentIntentId,
              amount: amount ? amount : undefined,
              reason: cardData.reason as stripe.RefundCreateParams.Reason,
              reverse_transfer: cardData.reverse_transfer,
              metadata: {
                transactionId: transactionId,
              },
            });
          } catch (refundError: unknown) {
            if (refundError instanceof stripe.errors.StripeError) {
              this.logger.error('Error creating refund', refundError);
              await this.snsService.publish(
                process.env.TRANSACTION_STATUS_TOPIC_ARN!,
                {
                  transactionId,
                  status: 'FAILED',
                  type: 'CREATE',
                  amount,
                  merchantId,
                  transactionType: 'REFUND',
                  metaData,
                }
              );

              throw refundError;
            }
          }

          this.logger.info('Refund processed', refund);
          await this.snsService.publish(
            process.env.TRANSACTION_STATUS_TOPIC_ARN!,
            {
              paymentMethod: 'Stripe',
              transactionId: transactionId,
              status: refund?.status as string,
              type: 'UPDATE',
              amount,
              merchantId,
              transactionType: 'REFUND',
              metaData,
            }
          );

          return {
            transactionId: transactionId,
            status: refund?.status as string,
          };
        } catch (error) {
          this.logger.error('Unexpected error processing refund', error);
          throw error;
        }
      }

      default:
        throw new Error(`Unsupported transaction type: ${transactionType}`);
    }
  }
}
