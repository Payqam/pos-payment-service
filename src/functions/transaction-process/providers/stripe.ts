import stripe from 'stripe';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { CardData, CreatePaymentRecord, SNSMessage } from '../../../model';
import { SNSService } from '../../../services/snsService';
import { v4 as uuidv4 } from 'uuid';
import { EnhancedError, ErrorCategory } from '../../../../utils/errorHandler';

export class CardPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  private readonly snsService: SNSService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
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
        const transactionId = uuidv4();
        try {
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
              await this.snsService.publish({
                transactionId,
                paymentMethod: 'Stripe',
                status: 'FAILED',
                type: 'CREATE',
                amount: amount || '',
                merchantId,
                transactionType: 'CHARGE',
                metaData,
                fee: feeAmount || '',
                createdOn: dateTime,
                customerPhone,
                currency: currency,
                exchangeRate: '',
                processingFee: '',
                netAmount: '',
                externalTransactionId: '',
                merchantMobileNo: '',
                payeeNote: '',
                partyId: '',
                partyIdType: '',
                payerMessage: '',
                settlementAmount: '',
                TransactionError: {
                  ErrorCode: '',
                  ErrorMessage: '',
                  ErrorType: '',
                  ErrorSource: '',
                },
              } as SNSMessage);
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

          await this.snsService.publish({
            transactionId,
            paymentMethod: 'Stripe',
            status: paymentIntent?.status,
            type: 'CREATE',
            amount: amount || '',
            merchantId,
            transactionType: 'CHARGE',
            metaData,
            fee: feeAmount || '',
            createdOn: dateTime,
            customerPhone,
            currency: currency,
            exchangeRate: '',
            processingFee: '',
            netAmount: '',
            externalTransactionId: '',
            merchantMobileNo: '',
            payeeNote: '',
            partyId: '',
            partyIdType: '',
            payerMessage: '',
            settlementAmount: '',
            TransactionError: {
              ErrorCode: '',
              ErrorMessage: '',
              ErrorType: '',
              ErrorSource: '',
            },
          } as SNSMessage);

          return {
            transactionId,
            status: paymentIntent?.status as string,
          };
        } catch (error: unknown) {
          this.logger.error('Error processing charge', error);
          throw new EnhancedError(
            'STRIPE_ERROR',
            ErrorCategory.PROVIDER_ERROR,
            error instanceof Error ? error.message : String(error),
            {
              retryable: false,
              transactionId: transactionId,
            }
          );
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
              await this.snsService.publish({
                transactionId,
                status: 'FAILED',
                type: 'CREATE',
                amount,
                merchantId,
                transactionType: 'REFUND',
                metaData,
              });

              throw refundError;
            }
          }

          this.logger.info('Refund processed', refund);
          await this.snsService.publish({
            paymentMethod: 'Stripe',
            transactionId: transactionId,
            status: refund?.status as string,
            type: 'UPDATE',
            amount,
            merchantId,
            transactionType: 'REFUND',
            metaData,
          });

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
