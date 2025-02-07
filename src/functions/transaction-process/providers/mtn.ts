import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

/**
 * MTN API credentials structure with separate configurations for collection and disbursement.
 * This separation is required as MTN provides different API keys for each service.
 */
interface MTNCredentials {
  collection: {
    subscriptionKey: string;
    apiUser: string;
    apiKey: string;
  };
  disbursement: {
    subscriptionKey: string;
    apiUser: string;
    apiKey: string;
  };
  targetEnvironment: string;
  webhookSecret: string;
}

/**
 * MTN API token response structure
 */
interface MTNToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Enum defining the types of transactions supported by MTN Mobile Money.
 * - PAYMENT: For collecting money from customers
 * - TRANSFER: For disbursing money to merchants
 */
export enum TransactionType {
  PAYMENT = 'payment',
  TRANSFER = 'transfer',
}

/**
 * Service class for handling MTN Mobile Money payment operations.
 * Supports both collection (customer payments) and disbursement (merchant transfers) operations.
 */
export class MtnPaymentService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  private readonly baseUrl: string;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.baseUrl =
      process.env.MTN_API_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
    this.logger.info('init()');
  }

  /**
   * Creates a new axios instance for the specified transaction type.
   * A new instance is created for each call to ensure we're using fresh tokens.
   *
   * @param type - The type of transaction (PAYMENT or TRANSFER)
   * @returns An axios instance configured with the appropriate credentials and token
   */
  private async createAxiosInstance(
    type: TransactionType
  ): Promise<AxiosInstance> {
    const credentials = await this.getMTNCredentials();
    const token = await this.generateToken(credentials, type);
    const creds =
      type === TransactionType.PAYMENT
        ? credentials.collection
        : credentials.disbursement;

    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'X-Target-Environment': credentials.targetEnvironment,
        'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
        'X-Reference-Id': uuidv4(),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  }

  /**
   * Retrieves MTN API credentials from AWS Secrets Manager.
   * The secret contains separate credentials for collection and disbursement operations.
   *
   * @returns The MTN credentials object
   */
  private async getMTNCredentials(): Promise<MTNCredentials> {
    const secret = await this.secretsManagerService.getSecret(
      process.env.MTN_API_SECRET as string
    );
    return secret as unknown as MTNCredentials;
  }

  /**
   * Generates an access token for MTN API operations.
   * Different tokens are generated for collection and disbursement operations.
   *
   * @param credentials - The MTN credentials object
   * @param type - The type of transaction (PAYMENT or TRANSFER)
   * @returns A token object containing the access token and expiry
   */
  private async generateToken(
    credentials: MTNCredentials,
    type: TransactionType
  ): Promise<MTNToken> {
    try {
      const apiPath =
        type === TransactionType.PAYMENT
          ? '/collection/token/'
          : '/disbursement/token/';
      const creds =
        type === TransactionType.PAYMENT
          ? credentials.collection
          : credentials.disbursement;

      const response = await axios.post(
        `${this.baseUrl}${apiPath}`,
        {},
        {
          headers: {
            'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
            Authorization: `Basic ${Buffer.from(creds.apiUser + ':' + creds.apiKey).toString('base64')}`,
          },
        }
      );
      return response.data;
    } catch (error) {
      this.logger.error('Error generating MTN token', error);
      throw new Error('Failed to generate MTN token');
    }
  }

  /**
   * Processes a payment request from a customer.
   * Creates a payment request via MTN's collection API and stores the transaction in DynamoDB.
   *
   * @param amount - The payment amount
   * @param mobileNo - Customer's mobile number (MSISDN format)
   * @param currency - Payment currency (default: EUR)
   * @param metaData - Optional metadata for the transaction
   * @returns The transaction ID for tracking
   */
  public async processPayment(
    amount: number,
    mobileNo: string,
    merchantId: string,
    currency: string = 'EUR',
    metaData?: Record<string, string>
  ): Promise<string> {
    this.logger.info('Processing MTN Mobile Money payment', {
      amount,
      mobileNo,
      currency,
    });

    try {
      const axiosInstance = await this.createAxiosInstance(
        TransactionType.PAYMENT
      );
      // TODO: Do we need the external ID?
      const transactionId = uuidv4();

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
        merchantId,
      };

      await this.dbService.createPaymentRecord(record);
      this.logger.info('Payment record created in DynamoDB', record);

      return transactionId;
    } catch (error) {
      this.logger.error('Error processing MTN payment', error);
      throw error;
    }
  }

  /**
   * Checks the status of a transaction (payment or transfer).
   *
   * @param transactionId - The ID of the transaction to check
   * @param type - The type of transaction (PAYMENT or TRANSFER)
   * @returns The current status of the transaction
   */
  public async checkTransactionStatus(
    transactionId: string,
    type: TransactionType
  ): Promise<string> {
    try {
      const axiosInstance = await this.createAxiosInstance(type);
      const endpoint =
        type === TransactionType.PAYMENT
          ? `/collection/v1_0/requesttopay/${transactionId}`
          : `/disbursement/v1_0/transfer/${transactionId}`;

      const response = await axiosInstance.get(endpoint);
      return response.data.status;
    } catch (error) {
      this.logger.error('Error checking transaction status', {
        error,
        transactionId,
        type,
      });
      throw error;
    }
  }

  /**
   * Initiates a transfer to a merchant.
   * Uses MTN's disbursement API to send money to a specified mobile number.
   *
   * @param amount - The amount to transfer
   * @param recipientMobileNo - Recipient's mobile number (MSISDN format)
   * @param currency - Transfer currency (default: EUR)
   * @returns The transfer ID for tracking
   */
  public async initiateTransfer(
    amount: number,
    recipientMobileNo: string,
    currency: string = 'EUR'
  ): Promise<string> {
    try {
      const axiosInstance = await this.createAxiosInstance(
        TransactionType.TRANSFER
      );
      const transferId = uuidv4();

      // Response
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
}
