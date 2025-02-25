import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { CacheService } from '../../../services/cacheService';
import { v4 as uuidv4 } from 'uuid';
import { CreatePaymentRecord } from '../../../model';
import axios, { AxiosInstance } from 'axios';
import * as querystring from 'querystring';
import {
  OrangeToken,
  PaymentInitResponse,
  PaymentResponse,
  OrangePaymentRecord,
  TransactionType
} from '../interfaces/orange';

/**
 * Service class for handling Orange Money payment operations.
 * Supports both collection (customer payments) and disbursement (merchant transfers) operations.
 */
export class OrangePaymentService {
  private readonly logger: Logger;
  private readonly secretsManagerService: SecretsManagerService;
  private readonly dbService: DynamoDBService;
  private readonly cacheService: CacheService;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private currentToken: OrangeToken | null;
  private tokenExpiryTime: number;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.cacheService = new CacheService();
    this.baseUrl = process.env.ORANGE_API_BASE_URL || 'https://omdeveloper-gateway.orange.cm';
    this.tokenUrl = process.env.ORANGE_TOKEN_URL || 'https://omdeveloper.orange.cm/oauth2/token';
    this.currentToken = null;
    this.tokenExpiryTime = 0;
    this.logger.info('init()');
  }

  /**
   * Generates an access token for Orange API operations.
   * Handles token caching and renewal based on expiry.
   * 
   * @returns A token object containing the access token and expiry
   */
  private async generateToken(): Promise<OrangeToken> {
    try {
      // Check if we have a valid cached token
      const currentTime = Math.floor(Date.now() / 1000);
      if (this.currentToken && currentTime < this.tokenExpiryTime) {
        this.logger.info('Using cached token');
        return this.currentToken;
      }

      const clientId = process.env.ORANGE_CLIENT_ID;
      if (!clientId) {
        throw new Error('ORANGE_CLIENT_ID environment variable is not set');
      }

      const response = await axios.post(
        this.tokenUrl,
        querystring.stringify({
          grant_type: 'client_credentials'
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${clientId}`
          }
        }
      );

      const token: OrangeToken = response.data;
      
      // Store token and calculate expiry time (subtract 60 seconds as buffer)
      this.currentToken = token;
      this.tokenExpiryTime = currentTime + (token.expires_in - 60);

      this.logger.info('Generated new Orange token', {
        expiresIn: token.expires_in,
        tokenType: token.token_type
      });

      return token;
    } catch (error) {
      this.logger.error('Error generating Orange token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenUrl: this.tokenUrl
      });
      throw new Error('Failed to generate Orange token');
    }
  }

  /**
   * Creates headers for Orange API requests with the current token.
   * 
   * @returns Headers object for the API request
   */
  private async createHeaders(): Promise<Record<string, string>> {
    const token = await this.generateToken();
    const authToken = process.env.ORANGE_X_AUTH_TOKEN;
    if (!authToken) {
      throw new Error('ORANGE_X_AUTH_TOKEN environment variable is not set');
    }

    return {
      'WSO2-Authorization': `Bearer ${token.access_token}`,
      'X-AUTH-TOKEN': authToken,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    };
  }

  /**
   * Creates a new axios instance with the current token.
   * A new instance is created for each call to ensure we're using fresh tokens.
   * 
   * @returns An axios instance configured with the appropriate credentials and token
   */
  private async createAxiosInstance(): Promise<AxiosInstance> {
    const headers = await this.createHeaders();
    return axios.create({
      baseURL: this.baseUrl,
      headers
    });
  }

  /**
   * Initiates a merchant payment transaction
   * 
   * @returns PayToken for the payment
   */
  private async initiateMerchantPayment(): Promise<string> {
    try {
      const axiosInstance = await this.createAxiosInstance();
      const response = await axiosInstance.post<PaymentInitResponse>(
        '/omapi/1.0.2/mp/init',
        {}
      );

      this.logger.info('Payment initialization successful', {
        message: response.data.message,
        payToken: response.data.data.payToken
      });

      return response.data.data.payToken;
    } catch (error) {
      this.logger.error('Error initiating merchant payment', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to initiate merchant payment');
    }
  }

  /**
   * Processes a payment request from a customer.
   * Creates a payment request via Orange's API and stores the transaction in DynamoDB.
   *
   * @param amount - The payment amount
   * @param mobileNo - Customer's mobile number
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
    this.logger.info('Processing Orange Money payment', { amount, mobileNo });

    try {
      const axiosInstance = await this.createAxiosInstance();
      const merchantPhone = process.env.ORANGE_PAYQAM_MERCHANT_PHONE;
      const notifyUrl = process.env.ORANGE_NOTIFY_URL;
      const pin = process.env.ORANGE_PAYQAM_PIN;

      if (!merchantPhone || !notifyUrl || !pin) {
        throw new Error('Required environment variables are not set');
      }

      // Step 1: Initialize payment and get payToken
      const payToken = await this.initiateMerchantPayment();

      // Step 2: Process the payment
      const orderId = uuidv4();
      const response = await axiosInstance.post<PaymentResponse>('/omapi/1.0.2/mp/pay', {
        notifUrl: notifyUrl,
        channelUserMsisdn: merchantPhone,
        amount,
        subscriberMsisdn: mobileNo,
        pin,
        orderId,
        description: metaData?.description || 'PayQam payment',
        payToken
      });

      const paymentData = response.data.data;
      
      // Create payment record
      const record: OrangePaymentRecord = {
        transactionId: paymentData.txnid,
        merchantId,
        amount,
        paymentMethod: 'ORANGE',
        createdOn: Math.floor(Date.now() / 1000),
        status: paymentData.status,
        paymentProviderResponse: paymentData,
        metaData: {
          ...metaData,
          payToken,
          orderId
        }
      };

      // Convert to CreatePaymentRecord for database storage
      const dbRecord: CreatePaymentRecord = {
        ...record,
        paymentProviderResponse: undefined, // Remove Orange-specific response
        metaData: {
          ...record.metaData,
          orangeResponse: JSON.stringify(paymentData) // Store Orange response as string in metadata
        }
      };

      await this.dbService.createPaymentRecord(dbRecord);

      return paymentData.txnid;
    } catch (error) {
      this.logger.error('Error processing Orange Money payment', {
        error: error instanceof Error ? error.message : 'Unknown error',
        amount,
        mobileNo
      });
      throw error;
    }
  }
}
