import { SNSEvent, SNSHandler } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../services/secretsManagerService';
import axios from 'axios';

interface SalesforceCredentials {
  clientSecret: string;
  clientId: string;
}
interface SNSMessage {
  transactionId: string;
  status: string;
  amount: number;
  merchantId: string;
  transactionType: string;
  metaData: { deviceId: string };
  fee: number;
  type: string;
  customerPhone: string;
  createdOn: number;
}

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
      const urlHost = process.env.SALESFORCE_URL_HOST as string;
      const authResponse = await axios.post(
        `${urlHost}/services/oauth2/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
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

  private async handlePaymentStatusUpdate(
    message: SNSMessage,
    credentials: SalesforceCredentials
  ) {
    try {
      this.logger.info('Handling payment status update', { message });
      const accessToken = await this.getAccessToken(credentials);
      const urlHost = process.env.SALESFORCE_URL_HOST as string;

      // Fetch existing record
      const queryUrl = `${urlHost}/services/data/v60.0/query/?q=SELECT+Id,Name+FROM+Transaction__c+WHERE+Name='${message.transactionId}'`; // todo update this according to production account
      const queryResponse = await axios.get(queryUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!queryResponse.data.records.length) {
        throw new Error(
          `No Salesforce record found for transactionId: ${message.transactionId}`
        );
      }

      const recordId = queryResponse.data.records[0].Id;
      this.logger.info('Successfully retrieved Salesforce record ID', {
        recordId,
      });

      // Update Salesforce Record
      const recordPayload = {
        Name: message.transactionId,
        status__c: message.status,
        amount__c: message.amount,
        merchantId__c: message.merchantId,
      };

      await axios.patch(
        `${urlHost}/services/data/v60.0/sobjects/transaction__c/${recordId}`,
        recordPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.info('Successfully updated Salesforce record', { recordId });
    } catch (error) {
      this.logger.error('Error updating Salesforce record', { error });
      throw new Error('Failed to update Salesforce record');
    }
  }

  private async handlePaymentCreated(
    message: SNSMessage,
    credentials: SalesforceCredentials
  ) {
    try {
      this.logger.info('Handling payment created', { message });

      const accessToken = await this.getAccessToken(credentials);
      const urlHost = process.env.SALESFORCE_URL_HOST as string;

      const recordPayload = {
        OwnerId: process.env.SALESFORCE_OWNER_ID,
        Name: message.transactionId,
        status__c: message.status,
        amount__c: message.amount,
        merchantId__c: message.merchantId,
        transactionType__c: message.transactionType,
        fee__c: message.fee,
        transaction_date_time__c: message.createdOn,
        device_id__c: message.metaData.deviceId,
        customer_phone__c: message.customerPhone,
      };

      this.logger.info('Creating Salesforce Payment record', { recordPayload });

      const createRecordResponse = await axios.post(
        `${urlHost}/services/data/v63.0/sobjects/transaction__c/`,
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

          switch (message.type) {
            case 'UPDATE':
              await this.handlePaymentStatusUpdate(message, credentials);
              break;
            case 'CREATE':
              await this.handlePaymentCreated(message, credentials);
              break;
            default:
              this.logger.warn('Unknown event type', {
                eventType: message.type,
              });
          }
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
