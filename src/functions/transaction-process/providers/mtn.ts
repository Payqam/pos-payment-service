import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { CreatePaymentRecord } from '../../../model';

const PAYQAM_FEE_PERCENTAGE = parseFloat(
  process.env.PAYQAM_FEE_PERCENTAGE || '2.5'
);

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
   * Calculates PayQAM's fee and the merchant's settlement amount
   *
   * @param amount - Original payment amount
   * @returns Object containing fee and settlement amounts
   */
  private calculateFeeAndSettlement(amount: number): {
    fee: number;
    settlementAmount: number;
  } {
    const feePercentage = PAYQAM_FEE_PERCENTAGE / 100;
    const fee = Math.round(amount * feePercentage); // Round to nearest cent
    return {
      fee,
      settlementAmount: amount - fee,
    };
  }

  /**
   * Creates headers for MTN API requests based on the transaction type and token.
   * Different endpoints require different headers, but some are common across all.
   *
   * @param type - The type of transaction (PAYMENT or TRANSFER)
   * @param credentials - MTN API credentials
   * @param token - Access token for the API
   * @param transactionId - Optional transaction ID for reference
   * @returns Headers object for the API request
   */
  private createHeaders(
    type: TransactionType,
    credentials: MTNCredentials,
    token?: MTNToken,
    transactionId?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Ocp-Apim-Subscription-Key':
        type === TransactionType.PAYMENT
          ? credentials.collection.subscriptionKey
          : credentials.disbursement.subscriptionKey,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Target-Environment': credentials.targetEnvironment,
    };

    // Add authorization if token is provided
    if (token) {
      headers.Authorization = `Bearer ${token.access_token}`;
    }

    // Add reference ID if provided, otherwise generate new one
    headers['X-Reference-Id'] = transactionId || uuidv4();

    // Add callback URL based on transaction type
    if (process.env.MTN_WEBHOOK_URL) {
      if (
        type === TransactionType.PAYMENT ||
        type === TransactionType.TRANSFER
      ) {
        headers['X-Callback-Url'] = process.env.MTN_WEBHOOK_URL;
        this.logger.info('Added callback URL to headers', {
          type,
          callbackUrl: process.env.MTN_WEBHOOK_URL,
        });
      }
    }

    this.logger.info('Generated headers for MTN request', {
      type,
      headers,
      hasCallbackUrl: !!headers['X-Callback-Url'],
    });

    return headers;
  }

  /**
   * Creates a new axios instance for the specified transaction type.
   * A new instance is created for each call to ensure we're using fresh tokens.
   *
   * @param type - The type of transaction (PAYMENT or TRANSFER)
   * @param transactionId - Optional transaction ID for reference
   * @returns An axios instance configured with the appropriate credentials and token
   */
  private async createAxiosInstance(
    type: TransactionType,
    transactionId?: string
  ): Promise<AxiosInstance> {
    const credentials = await this.getMTNCredentials();
    const token = await this.generateToken(credentials, type);

    return axios.create({
      baseURL: this.baseUrl,
      headers: this.createHeaders(type, credentials, token, transactionId),
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

      const config = {
        baseURL: this.baseUrl,
        auth: {
          username: creds.apiUser,
          password: creds.apiKey,
        },
        headers: {
          'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
          'Content-Type': 'application/json',
        },
      };

      const response = await axios.post(apiPath, {}, config);

      // Only log scalar values from the token response
      this.logger.info('Successfully generated MTN token', {
        tokenType: response.data.token_type,
        expiresIn: response.data.expires_in,
      });

      return response.data;
    } catch (error) {
      // Only log the error message, not the full error object
      this.logger.error('Error generating MTN token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        type,
        baseURL: this.baseUrl,
      });
      throw new Error('Failed to generate MTN token');
    }
  }

  /**
   * Processes a payment request from a customer.
   * Creates a payment request via MTN's collection API and stores the transaction in DynamoDB.
   *
   * @param amount - The payment amount
   * @param mobileNo - Customer's mobile number (MSISDN format)
   * @param merchantId - ID of the merchant receiving the payment
   * @param merchantMobileNo - Merchant's mobile number for disbursement
   * @param metaData - Optional metadata for the transaction
   * @param currency - Payment currency (default: EUR)
   * @returns The transaction ID for tracking
   */
  public async processPayment(
    amount: number,
    mobileNo: string,
    merchantId: string,
    merchantMobileNo: string,
    metaData?: Record<string, never> | Record<string, string>,
    currency: string = 'EUR'
  ): Promise<string> {
    const transactionId = uuidv4();
    this.logger.info('Processing MTN payment', {
      transactionId,
      amount,
      mobileNo,
      merchantId,
      merchantMobileNo,
      currency,
    });

    try {
      const axiosInstance = await this.createAxiosInstance(
        TransactionType.PAYMENT,
        transactionId
      );

      const { fee, settlementAmount } = this.calculateFeeAndSettlement(amount);

      // Create payment request in MTN
      await axiosInstance.post('/collection/v1_0/requesttopay', {
        amount: amount.toString(),
        currency,
        externalId: transactionId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: mobileNo,
        },
        payerMessage: 'PayQAM payment request',
        payeeNote: 'Thank you for your payment',
      });

      // Store transaction record in DynamoDB
      const paymentRecord: CreatePaymentRecord = {
        transactionId,
        amount,
        currency,
        paymentMethod: 'MTN',
        createdOn: Math.floor(Date.now() / 1000),
        status: 'PENDING',
        mobileNo,
        merchantId,
        merchantMobileNo,
        metaData,
        fee,
        settlementAmount,
      };

      await this.dbService.createPaymentRecord(paymentRecord);

      this.logger.info('Payment request created successfully', {
        transactionId,
        status: 'PENDING',
      });

      return transactionId;
    } catch (error) {
      this.logger.error('Failed to process payment', {
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId,
      });
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
        error: error instanceof Error ? error.message : 'Unknown error',
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

      // Log the request details (mask sensitive data)
      this.logger.info('Initiating MTN transfer', {
        amount,
        currency,
        recipientMobileNo: recipientMobileNo.replace(/\d(?=\d{4})/g, '*'),
      });

      const transactionId = uuidv4();
      const response = await axiosInstance.post('/disbursement/v1_0/transfer', {
        amount: amount.toString(),
        currency,
        externalId: transactionId,
        payee: {
          partyIdType: 'MSISDN',
          partyId: recipientMobileNo,
        },
        payerMessage: 'PayQAM merchant disbursement',
        payeeNote: 'Payment from your customer',
      });

      // Log successful transfer
      this.logger.info('Transfer initiated successfully', {
        transactionId,
        status: response.status,
        statusText: response.statusText,
      });

      return transactionId;
    } catch (error) {
      // Log detailed error information
      this.logger.error('Failed to initiate transfer', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
