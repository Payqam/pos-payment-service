import { SNSEvent, SNSHandler } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../services/secretsManagerService';
import axios from 'axios';
import { registerRedactFilter } from '../../../utils/redactUtil';
import { SalesforceCredentials, SNSMessage } from '../../model';
import { SalesforcePaymentRecord } from '../../model/salesforce';

const sensitiveFields = ['clientId', 'clientSecret', 'username', 'password'];
registerRedactFilter(sensitiveFields);

export class SalesforceSyncService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
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
    try {
      // const urlHost = process.env.SALESFORCE_URL_HOST as string;
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
      this.logger.error('Error fetching Salesforce auth token', { error });
      throw new Error('Failed to fetch Salesforce auth token');
    }
  }

  private async handlePaymentCreated(
    message: SNSMessage,
    credentials: SalesforceCredentials
  ) {
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
              TransactionError: {
                ErrorCode__c: message.TransactionError.ErrorCode,
                ErrorMessage__c: message.TransactionError.ErrorMessage,
                ErrorType__c: message.TransactionError.ErrorType,
                ErrorSource__c: message.TransactionError.ErrorSource,
              },
            }
          : {};

      const recordPayload: SalesforcePaymentRecord = {
        OwnerId: credentials.ownerId ?? '',
        ServiceType__c: message.paymentMethod ?? '',
        transactionId__c: message.transactionId ?? '',
        status__c: message.status ?? '',
        amount__c: message.settlementAmount ?? '',
        MerchantId__c: message.merchantId ?? '',
        Merchant_Phone__c: message.merchantMobileNo ?? '',
        Transaction_Type__c: message.transactionType ?? '',
        metaData__c: message.metaData ? JSON.stringify(message.metaData) : '',
        Fee__c: message.fee ?? '',
        Device_Id__c: message.metaData?.deviceId ?? '',
        Transaction_Date_Time__c: message.createdOn ?? '',
        Customer_Phone__c: message.customerPhone ?? '',
        currency__c: message.currency ?? '',
        Exchange_Rate__c: message.exchangeRate ?? '',
        Processing_Fee__c: message.processingFee ?? '',
        Net_Amount__c: message.amount ?? '',
        ExternalTransactionId__c: message.externalTransactionId ?? '',
        ...transactionError,
      };

      this.logger.info('Creating Salesforce Payment record', { recordPayload });

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
    } catch (error) {
      this.logger.error('Error creating Salesforce record', { error });
      throw new Error('Failed to create Salesforce record');
    }
  }

  public async processEvent(event: SNSEvent): Promise<void> {
    this.logger.info('Processing Salesforce sync event', { event });

    try {
      const credentials = await this.getSalesforceCredentials();

      for (const record of event.Records) {
        try {
          const message: SNSMessage = JSON.parse(record.Sns.Message);
          this.logger.info('Processing message', {
            messageId: record.Sns.MessageId,
          });
          this.logger.info('Create case', { message });
          await this.handlePaymentCreated(message, credentials);
        } catch (messageError) {
          this.logger.error('Error processing individual message', {
            error: messageError,
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
