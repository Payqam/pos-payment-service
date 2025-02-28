import { SNSEvent, SNSHandler } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../services/secretsManagerService';
import axios from 'axios';
import { registerRedactFilter } from '../../../utils/redactUtil';

// Configure sensitive field redaction in logs
const sensitiveFields = ['clientId', 'clientSecret', 'username', 'password'];
registerRedactFilter(sensitiveFields);

interface SalesforceCredentials {
  clientSecret: string;
  clientId: string;
}
interface SNSMessage {
  transactionId: string;
  status: string;
  amount: string;
  merchantId: string;
  transactionType: string;
  metaData: { deviceId: string };
  fee: string;
  type: string;
  customerPhone: string;
  createdOn: number;
  currency: string;
  exchangeRate: string;
  processingFee: string;
  netAmount: string;
  externalTransactionId: string;
  paymentMethod: string;
  TransactionError: {
    ErrorCode: string;
    ErrorMessage: string;
    ErrorType: string;
    ErrorSource: string;
  };
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

  // private async getAccessToken(
  //   credentials: SalesforceCredentials
  // ): Promise<string> {
  //   try {
  //     const urlHost = process.env.SALESFORCE_URL_HOST as string;
  //     const authResponse = await axios.post(
  //       `${urlHost}/services/oauth2/token`,
  //       new URLSearchParams({
  //         grant_type: 'client_credentials',
  //         client_id: credentials.clientId,
  //         client_secret: credentials.clientSecret,
  //       }),
  //       {
  //         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  //       }
  //     );
  //
  //     this.logger.info('Successfully retrieved Salesforce auth token');
  //     return authResponse.data.access_token;
  //   } catch (error) {
  //     this.logger.error('Error fetching Salesforce auth token', { error });
  //     throw new Error('Failed to fetch Salesforce auth token');
  //   }
  // }
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
          username: 'kokiladev@qriomatrix.com',
          password: 'qr!0Matrixs18oDSyszN2oca8x5SY8qyFz',
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
      const queryUrl = `${urlHost}/services/data/v60.0/query/?q=SELECT+Id,Name+FROM+Transaction__c+WHERE+transactionId__c='${message.transactionId}'`; // todo update this according to production account
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
        transactionId__c: message.transactionId,
        status__c: message.status,
        amount__c: message.amount,
        merchantId__c: message.merchantId,
      };

      await axios.patch(
        `${urlHost}/services/data/v60.0/sobjects/Transaction__c/${recordId}`,
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
        ServiceType__c: message.paymentMethod,
        transactionId__c: message.transactionId,
        status__c: message.status,
        amount__c: message.amount,
        merchantId__c: message.merchantId,
        Transaction_Type__c: message.transactionType,
        metaData__C: JSON.stringify(message.metaData),
        fee__c: message.fee,
        Device_id__c: message.metaData.deviceId,
        Transaction_Date_Time__c: message.createdOn,
        Customer_Phone__c: message.customerPhone,
        Currency__c: message.currency,
        Exchange_Rate__c: message.exchangeRate,
        Processing_Fee__c: message.processingFee,
        Net_Amount__c: message.netAmount,
        ExternalTransactionId__c: message.externalTransactionId,
      };

      this.logger.info('Creating Salesforce Payment record', { recordPayload });

      const createRecordResponse = await axios.post(
        `${urlHost}/services/data/v63.0/sobjects/Transaction__c/`,
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

  private async handlePaymentError(
    message: SNSMessage,
    credentials: SalesforceCredentials
  ) {
    try {
      this.logger.info('Handling payment failure', { message });

      // Get Salesforce Access Token
      let accessToken: string;
      try {
        accessToken = await this.getAccessToken(credentials);
      } catch (error) {
        this.logger.error('Failed to retrieve Salesforce access token', {
          error,
        });
        throw new Error('Failed to authenticate with Salesforce');
      }

      const urlHost = process.env.SALESFORCE_URL_HOST as string;
      const queryUrl = `${urlHost}/services/data/v60.0/query/?q=SELECT+Id,Name+FROM+Transaction__c+WHERE+transactionId__c='${message.transactionId}'`;

      this.logger.info('Fetching Salesforce record', { queryUrl });

      // Fetch the Salesforce record
      let recordId: string;
      try {
        const queryResponse = await axios.get(queryUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!queryResponse.data.records.length) {
          throw new Error(
            `No Salesforce record found for transactionId: ${message.transactionId}`
          );
        }

        recordId = queryResponse.data.records[0].Id;
        this.logger.info('Successfully retrieved Salesforce record', {
          recordId,
        });
      } catch (error) {
        this.logger.error('Failed to fetch Salesforce record', { error });
        throw new Error('Salesforce record lookup failed');
      }

      // Prepare transaction error payload
      const recordPayload = {
        Transaction__c: recordId,
        Error_Type__c: message.TransactionError.ErrorType,
        Error_Source__c: message.TransactionError.ErrorSource,
        Error_Message__c: message.TransactionError.ErrorMessage,
        Error_Code__c: message.TransactionError.ErrorCode,
      };

      // Create a new error record in Salesforce
      try {
        const createRecordResponse = await axios.post(
          `${urlHost}/services/data/v63.0/sobjects/Transaction_Error__c/`,
          recordPayload,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        this.logger.info('Successfully created Salesforce failed record', {
          recordId: createRecordResponse.data.id,
        });
      } catch (error) {
        this.logger.error('Failed to create Salesforce error record', {
          error,
        });
        throw new Error('Failed to log transaction error in Salesforce');
      }
    } catch (error) {
      this.logger.error('Error handling payment error', { error });
      throw new Error('Failed to handle payment error');
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
            case 'FAILED':
              await this.handlePaymentError(message, credentials);
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
