import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface MTNCredentials {
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  targetEnvironment: string;
}

interface MTNToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class MtnPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  private readonly baseUrl: string;

  private axiosInstance: AxiosInstance | null = null;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.baseUrl =
      process.env.MTN_API_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
    this.logger.info('init()');
  }

  private async getAxiosInstance(): Promise<AxiosInstance> {
    if (!this.axiosInstance) {
      const credentials = await this.getMTNCredentials();
      const token = await this.generateToken(credentials);

      this.axiosInstance = axios.create({
        baseURL: this.baseUrl,
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'X-Target-Environment': credentials.targetEnvironment,
          'Ocp-Apim-Subscription-Key': credentials.subscriptionKey,
          'X-Reference-Id': uuidv4(),
        },
      });
    }
    return this.axiosInstance;
  }

  private async getMTNCredentials(): Promise<MTNCredentials> {
    const secret = await this.secretsManagerService.getSecret(
      process.env.MTN_API_SECRET as string
    );
    return secret as unknown as MTNCredentials;
  }

  private async generateToken(credentials: MTNCredentials): Promise<MTNToken> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/collection/token/`,
        {},
        {
          headers: {
            'Ocp-Apim-Subscription-Key': credentials.subscriptionKey,
            Authorization: `Basic ${Buffer.from(credentials.apiUser + ':' + credentials.apiKey).toString('base64')}`,
          },
        }
      );
      return response.data;
    } catch (error) {
      this.logger.error('Error generating MTN token', error);
      throw new Error('Failed to generate MTN token');
    }
  }

  public async processPayment(
    amount: number,
    mobileNo: string,
    currency: string = 'EUR',
    metaData?: Record<string, string>
  ): Promise<string> {
    this.logger.info('Processing MTN Mobile Money payment', {
      amount,
      mobileNo,
      currency,
    });

    try {
      const axiosInstance = await this.getAxiosInstance();
      const transactionId = uuidv4();

      // Create payment request
      const response = await axiosInstance.post(
        '/collection/v1_0/requesttopay',
        {
          amount: amount.toString(),
          currency,
          externalId: transactionId,
          payer: {
            partyIdType: 'MSISDN',
            partyId: mobileNo,
          },
          payerMessage: 'Payment for services',
          payeeNote: 'PayQAM transaction',
        }
      );

      // Store transaction in DynamoDB
      const record = {
        transactionId,
        amount,
        currency,
        paymentMethod: 'MTN_MOBILE',
        createdOn: Math.floor(Date.now() / 1000),
        status: 'PENDING',
        paymentProviderResponse: response.data,
        metaData,
        mobileNo,
      };

      await this.dbService.createPaymentRecord(record);
      this.logger.info('Payment record created in DynamoDB', record);

      return transactionId;
    } catch (error) {
      this.logger.error('Error processing MTN payment', error);
      throw error;
    }
  }

  public async checkTransactionStatus(transactionId: string): Promise<string> {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get(
        `/collection/v1_0/requesttopay/${transactionId}`
      );

      return response.data.status;
    } catch (error) {
      this.logger.error('Error checking transaction status', error);
      throw error;
    }
  }

  public async initiateTransfer(
    amount: number,
    recipientMobileNo: string,
    currency: string = 'EUR'
  ): Promise<string> {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const transferId = uuidv4();

      await axiosInstance.post('/disbursement/v1_0/transfer', {
        amount: amount.toString(),
        currency,
        externalId: transferId,
        payee: {
          partyIdType: 'MSISDN',
          partyId: recipientMobileNo,
        },
        payerMessage: 'Disbursement from PayQAM',
        payeeNote: 'Merchant settlement',
      });

      return transferId;
    } catch (error) {
      this.logger.error('Error initiating transfer', error);
      throw error;
    }
  }

  public async checkTransferStatus(transferId: string): Promise<string> {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get(
        `/disbursement/v1_0/transfer/${transferId}`
      );

      return response.data.status;
    } catch (error) {
      this.logger.error('Error checking transfer status', error);
      throw error;
    }
  }
}
