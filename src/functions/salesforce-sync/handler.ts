import { SNSEvent, SNSHandler } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../services/secretsManagerService';
import axios, { AxiosError } from 'axios';
import { registerRedactFilter } from '../../../utils/redactUtil';
import { SalesforceCredentials, SNSMessage } from '../../model';
import { SalesforcePaymentRecord } from '../../model/salesforce';
import { SQS } from '@aws-sdk/client-sqs';

const sensitiveFields = ['clientId', 'clientSecret', 'username', 'password'];
registerRedactFilter(sensitiveFields);

// Maximum number of retry attempts
const MAX_RETRIES = 3;
// Delay between retries in milliseconds (exponential backoff)
const RETRY_DELAY_MS = 1000;

export class SalesforceSyncService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly sqs: SQS;

  constructor() {
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.sqs = new SQS();
    this.logger.info('SalesforceSyncService initialized');
  }

  private async getSalesforceCredentials(): Promise<SalesforceCredentials> {
    try {
      const secretResponse = await this.secretsManagerService.getSecret(
        process.env.SALESFORCE_SECRET as string
      );

      if (!secretResponse) {
        throw new Error('Salesforce credentials not found in Secrets Manager');
      }

      this.logger.info('Successfully retrieved Salesforce credentials');
      return secretResponse as unknown as SalesforceCredentials;
    } catch (error) {
      this.logger.error('Error retrieving Salesforce credentials', { error });
      throw new Error('Failed to retrieve Salesforce credentials');
    }
  }

  private async getAccessToken(
    credentials: SalesforceCredentials
  ): Promise<string> {
    let retryCount = 0;
    let lastError: AxiosError | Error | null = null;

    while (retryCount < MAX_RETRIES) {
      try {
        const authResponse = await axios.post(
          `https://login.salesforce.com/services/oauth2/token`,
          new URLSearchParams({
            grant_type: 'password',
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            username: credentials.username,
            password: credentials.password,
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }
        );

        this.logger.info('Successfully retrieved Salesforce auth token');
        return authResponse.data.access_token;
      } catch (error) {
        lastError = error as Error;
        retryCount++;

        if (retryCount < MAX_RETRIES) {
          this.logger.warn(
            `Auth token fetch failed, retrying (${retryCount}/${MAX_RETRIES})`,
            { error }
          );
          // Exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, retryCount - 1))
          );
        }
      }
    }

    this.logger.error('Error fetching Salesforce auth token after retries', {
      error: lastError,
    });
    throw new Error(
      'Failed to fetch Salesforce auth token after multiple attempts'
    );
  }

  private async sendToDeadLetterQueue(
    message: SNSMessage,
    error: Error
  ): Promise<void> {
    try {
      const dlqUrl = process.env.SALESFORCE_DLQ_URL;

      if (!dlqUrl) {
        this.logger.error('Dead letter queue URL not configured', { error });
        return;
      }

      await this.sqs.sendMessage({
        QueueUrl: dlqUrl,
        MessageBody: JSON.stringify({
          message,
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
          timestamp: new Date().toISOString(),
        }),
      });

      this.logger.info('Message sent to dead letter queue', {
        transactionId: message.transactionId,
        error: error.message,
      });
    } catch (dlqError) {
      this.logger.error('Failed to send message to dead letter queue', {
        originalError: error,
        dlqError,
      });
    }
  }

  private async handlePaymentCreated(
    message: SNSMessage,
    credentials: SalesforceCredentials
  ) {
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < MAX_RETRIES) {
      try {
        this.logger.info('Handling payment created', { message });

        const accessToken = await this.getAccessToken(credentials);
        const urlHost = credentials.host;
        const transactionError =
          message.TransactionError &&
          (message.TransactionError.ErrorMessage ||
            message.TransactionError.ErrorCode ||
            message.TransactionError.ErrorType ||
            message.TransactionError.ErrorSource)
            ? {
                transactionError: {
                  errorCode: message.TransactionError.ErrorCode,
                  errorMessage: message.TransactionError.ErrorMessage,
                  errorType: message.TransactionError.ErrorType,
                  errorSource: message.TransactionError.ErrorSource,
                },
              }
            : {};

        const recordPayload: SalesforcePaymentRecord = {
          ownerId: credentials.ownerId ?? '',
          serviceType: message.paymentMethod ?? '',
          transactionId: message.transactionId ?? '',
          status: message.status ?? '',
          amount: message.settlementAmount?.toString() ?? '',
          merchantId: message.merchantId ?? '',
          merchantPhone: message.merchantMobileNo ?? '',
          transactionType: message.transactionType ?? '',
          metaData: message.metaData ? JSON.stringify(message.metaData) : '',
          fee: message.fee?.toString() ?? '',
          deviceId: message.metaData?.deviceId ?? '',
          transactionDateTime: message.createdOn ?? '',
          customerPhone: message.customerPhone ?? '',
          currency: message.currency ?? '',
          exchangeRate: message.exchangeRate ?? '',
          processingFee: message.processingFee ?? '',
          netAmount: message.amount?.toString() ?? '',
          externalTransactionId: message.externalTransactionId ?? '',
          originalTransactionId: message.originalTransactionId ?? '',
          ...transactionError,
        };

        this.logger.info('Creating Salesforce Payment record', {
          recordPayload,
        });

        const createRecordResponse = await axios.post(
          `${urlHost}/services/apexrest/PayQam/Streaming`,
          recordPayload,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        this.logger.info('Successfully created Salesforce record', {
          recordId: createRecordResponse.data.id,
        });

        // Success, exit retry loop
        return;
      } catch (error) {
        lastError = error as Error;
        retryCount++;

        if (retryCount < MAX_RETRIES) {
          this.logger.warn(
            `Salesforce record creation failed, retrying (${retryCount}/${MAX_RETRIES})`,
            {
              error,
              transactionId: message.transactionId,
            }
          );
          // Exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, retryCount - 1))
          );
        }
      }
    }

    // All retries failed, send to DLQ
    this.logger.error('Error creating Salesforce record after retries', {
      error: lastError,
      transactionId: message.transactionId,
    });

    if (lastError) {
      await this.sendToDeadLetterQueue(message, lastError);
    }

    throw new Error(
      'Failed to create Salesforce record after multiple attempts'
    );
  }

  public async processEvent(event: SNSEvent): Promise<void> {
    this.logger.info('Processing Salesforce sync event', { event });

    try {
      // const credentials = await this.getSalesforceCredentials();

      for (const record of event.Records) {
        try {
          const message: SNSMessage = JSON.parse(record.Sns.Message);
          this.logger.info('Processing message', {
            messageId: record.Sns.MessageId,
          });
          this.logger.info('Create case', { message });
          // await this.handlePaymentCreated(message, credentials);
        } catch (messageError) {
          this.logger.error('Error processing individual message', {
            error: messageError,
            messageId: record.Sns.MessageId,
          });
        }
      }
    } catch (error) {
      this.logger.error('Error processing Salesforce sync event', { error });
      throw new Error('Failed to process Salesforce sync event');
    }
  }
}

export const handler: SNSHandler = async (event: SNSEvent) => {
  const service = new SalesforceSyncService();
  try {
    await service.processEvent(event);
  } catch (error) {
    console.error('Lambda Handler Error:', error);
    throw error;
  }
};
