import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';
import { CreatePaymentRecord } from '../../../model';
import { v4 as uuidv4 } from 'uuid';
import axios, { AxiosInstance } from 'axios';
import querystring from 'querystring';
import {
  OrangeToken,
  PaymentInitResponse,
  PaymentResponse
} from '../interfaces/orange';

/**
 * Orange API credentials structure
 */
interface OrangeCredentials {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  xAuthToken: string;
  notifyUrl: string;
  merchantPhone: string;
  merchantPin: string;
}

/**
 * Service class for handling Orange Money payment operations.
 * Supports both collection (customer payments) and disbursement (merchant transfers) operations.
 */
export class OrangePaymentService {
  private readonly logger: Logger;
  private readonly secretsManagerService: SecretsManagerService;
  private readonly dbService: DynamoDBService;
  private readonly snsService: SNSService;
  private currentToken: OrangeToken | null;
  private tokenExpiryTime: number;
  private readonly TOKEN_EXPIRY_BUFFER = 300; // 5 minutes buffer
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second
  private credentials: OrangeCredentials | null;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.currentToken = null;
    this.tokenExpiryTime = 0;
    this.credentials = null;
    this.logger.info('init()');
  }

  /**
   * Retrieves Orange API credentials from AWS Secrets Manager
   */
  private async getOrangeCredentials(): Promise<OrangeCredentials> {
    if (this.credentials) {
      return this.credentials;
    }

    const secret = await this.secretsManagerService.getSecret(
      process.env.ORANGE_API_SECRET as string
    );

    this.credentials = {
      baseUrl: secret.baseUrl,
      tokenUrl: secret.tokenUrl,
      clientId: secret.clientId,
      xAuthToken: secret.xAuthToken,
      notifyUrl: secret.notifyUrl,
      merchantPhone: secret.merchantPhone,
      merchantPin: secret.merchantPin,
    };

    return this.credentials;
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
      if (this.currentToken && currentTime < this.tokenExpiryTime - this.TOKEN_EXPIRY_BUFFER) {
        this.logger.info('Using cached token');
        return this.currentToken;
      }

      const credentials = await this.getOrangeCredentials();

      const response = await axios.post(
        credentials.tokenUrl,
        querystring.stringify({
          grant_type: 'client_credentials'
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentials.clientId}`
          }
        }
      );

      const token: OrangeToken = response.data;

      // Store token and calculate expiry time with buffer
      this.currentToken = token;
      this.tokenExpiryTime = currentTime + token.expires_in;

      this.logger.info('Generated new Orange token', {
        expiresIn: token.expires_in,
        tokenType: token.token_type,
        expiryTime: this.tokenExpiryTime
      });

      return token;
    } catch (error) {
      this.logger.error('Error generating Orange token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenUrl: (await this.getOrangeCredentials()).tokenUrl
      });
      throw new Error('Failed to generate Orange token');
    }
  }

  /**
   * Executes an API request with retry logic for token expiration
   * @param requestFn The API request function to execute
   * @returns The API response
   */
  private async executeWithRetry<T>(requestFn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as Error;
        
        // If it's a 401 error and we haven't reached max retries
        if (axios.isAxiosError(error) && error.response?.status === 401 && attempt < this.MAX_RETRIES) {
          this.logger.warn(`Token expired, attempt ${attempt}/${this.MAX_RETRIES}. Refreshing token...`);
          
          // Force token refresh
          this.currentToken = null;
          this.tokenExpiryTime = 0;
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Creates headers for Orange API requests with the current token.
   * 
   * @returns Headers object for the API request
   */
  private async createHeaders(): Promise<Record<string, string>> {
    const credentials = await this.getOrangeCredentials();
    const token = await this.generateToken();

    return {
      'WSO2-Authorization': `Bearer ${token.access_token}`,
      'X-AUTH-TOKEN': credentials.xAuthToken,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    };
  }

  /**
   * Creates an Axios instance with proper headers and base URL for Orange API requests
   */
  private async createAxiosInstance(): Promise<AxiosInstance> {
    const credentials = await this.getOrangeCredentials();
    const headers = await this.createHeaders();

    return axios.create({
      baseURL: credentials.baseUrl,
      headers,
      timeout: 10000,
    });
  }

  /**
   * Get the current status of a payment
   * @param payToken - The payment token to check status for
   * @returns The payment status response
   */
  public async getPaymentStatus(payToken: string): Promise<PaymentResponse> {
    return this.executeWithRetry(async () => {
      try {
        const axiosInstance = await this.createAxiosInstance();
        const response = await axiosInstance.get<PaymentResponse>(
          `/omapi/1.0.2/mp/paymentstatus/${payToken}`
        );

        this.logger.info('Payment status check successful', {
          payToken,
          status: response.data.data.status,
          inittxnstatus: response.data.data.inittxnstatus,
          confirmtxnstatus: response.data.data.confirmtxnstatus
        });

        return response.data;
      } catch (error) {
        this.logger.error('Error checking payment status', {
          error: error instanceof Error ? error.message : 'Unknown error',
          payToken
        });
        throw error;
      }
    });
  }

  /**
   * Initiates a merchant payment transaction
   * 
   * @returns PayToken for the payment
   */
  private async initiateMerchantPayment(): Promise<string> {
    return this.executeWithRetry(async () => {
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
    });
  }

  /**
   * Initiates a disbursement transaction
   * @param amount Amount to disburse
   * @param merchantMobileNo Merchant's mobile number
   * @returns PaymentInitResponse
   */
  public async initDisbursement(): Promise<PaymentInitResponse> {
    return this.executeWithRetry(async () => {
      try {
        const token = await this.generateToken();
        const headers = await this.createHeaders();

        const response = await axios.post(
          `${(await this.getOrangeCredentials()).baseUrl}/omapi/1.0.2/cashin/init`,
          {},
          { headers }
        );

        return response.data;
      } catch (error) {
        this.logger.error('Error initiating disbursement', { error });
        throw new Error('Failed to initiate disbursement');
      }
    });
  }

  /**
   * Executes a disbursement payment
   * @param params Disbursement parameters
   * @returns PaymentResponse
   */
  public async executeDisbursement(params: {
    channelUserMsisdn: string;
    amount: string;
    subscriberMsisdn: string;
    orderId: string;
    description: string;
    payToken: string;
  }): Promise<PaymentResponse> {
    return this.executeWithRetry(async () => {
      try {
        const token = await this.generateToken();
        const headers = await this.createHeaders();

        const response = await axios.post(
          `${(await this.getOrangeCredentials()).baseUrl}/omapi/1.0.2/cashin/pay`,
          {
            ...params,
            pin: (await this.getOrangeCredentials()).merchantPin
          },
          { headers }
        );

        return response.data;
      } catch (error) {
        this.logger.error('Error executing disbursement', { error });
        throw new Error('Failed to execute disbursement');
      }
    });
  }

  /**
   * Generates a formatted order ID with the given prefix
   * Format: PREFIX + YYYYMMDD + RANDOM4DIGITS
   * Example: OM-202502281234
   */
  private generateOrderId(prefix = 'OM'): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const uniqueNumber = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    return `${prefix}${year}${month}${day}${uniqueNumber}`.slice(0, 20);
  }

  /**
   * Publishes a transaction status update to SNS
   */
  private async publishTransactionStatus(params: {
    transactionId: string;
    status: string;
    type: string;
    amount: number;
    merchantId: string;
    transactionType: string;
    metaData?: Record<string, string>;
    fee: number;
    customerPhone?: string;
    currency?: string;
  }) {
    const timestamp = Math.floor(Date.now() / 1000);
    await this.snsService.publish(
      process.env.TRANSACTION_STATUS_TOPIC_ARN!,
      {
        transactionId: params.transactionId,
        paymentMethod: 'Orange',
        status: params.status,
        type: params.type,
        amount: params.amount,
        merchantId: params.merchantId,
        transactionType: params.transactionType,
        metaData: params.metaData,
        fee: params.fee,
        createdOn: timestamp,
        customerPhone: params.customerPhone,
        currency: params.currency || 'EUR',
        exchangeRate: 'N/A',
        processingFee: 'N/A',
        netAmount: 'N/A',
        externalTransactionId: 'N/A'
      }
    );
  }

  /**
   * Processes a payment request from a customer.
   * Creates a payment request via Orange's API and stores the transaction in DynamoDB.
   *
   * @param amount - The payment amount
   * @param customerPhone - Customer's mobile number
   * @param merchantId - ID of the merchant receiving the payment
   * @param merchantMobileNo - Merchant's mobile number for disbursement
   * @param metaData - Optional metadata for the transaction
   * @param transactionType - Type of transaction (CHARGE/REFUND)
   * @param currency - Payment currency (default: EUR)
   * @returns The transaction ID and status
   */
  public async processPayment(
    amount: number,
    customerPhone: string,
    merchantId: string,
    merchantMobileNo: string,
    metaData?: Record<string, never> | Record<string, string>,
    transactionType: string = 'CHARGE',
    currency: string = 'EUR'
  ): Promise<{ transactionId: string; status: string }> {
    this.logger.info('Processing Orange Money payment', { 
      amount, 
      customerPhone,
      transactionType 
    });

    switch (transactionType) {
      case 'CHARGE': {
        return this.processCharge(
          amount,
          customerPhone,
          merchantId,
          merchantMobileNo,
          metaData,
          currency
        );
      }

      case 'REFUND': {
        throw new Error('Orange Money refund functionality is not implemented yet');
      }

      default: {
        throw new Error(`Unsupported transaction type: ${transactionType}`);
      }
    }
  }

  /**
   * Processes a charge payment
   */
  private async processCharge(
    amount: number,
    customerPhone: string,
    merchantId: string,
    merchantMobileNo: string,
    metaData?: Record<string, never> | Record<string, string>,
    currency: string = 'EUR'
  ): Promise<{ transactionId: string; status: string }> {
    const transactionId = uuidv4();
    const feePercentage = 0.02;
    const feeAmount = Math.floor(amount * feePercentage);

    try {
      // Initialize payment
      const payToken = await this.initiateMerchantPayment();
      
      // Execute payment
      const paymentResponse = await this.executeWithRetry(async () => {
        const axiosInstance = await this.createAxiosInstance();
        const credentials = await this.getOrangeCredentials();
        const notifyUrl = credentials.notifyUrl;
        const pin = credentials.merchantPin;

        if (!notifyUrl || !pin) {
          throw new Error('Required environment variables are not set');
        }

        const orderId = this.generateOrderId();  // Using new order ID format
        
        this.logger.info('Generated payment identifiers', {
          transactionId,
          orderId,
          payToken
        });

        const response = await axiosInstance.post<PaymentResponse>('/omapi/1.0.2/mp/pay', {
          notifUrl: notifyUrl,
          channelUserMsisdn: credentials.merchantPhone,
          amount,
          subscriberMsisdn: customerPhone,
          pin,
          orderId,  // Using the formatted order ID
          description: metaData?.description || 'PayQam payment',
          payToken
        });

        return response.data;
      });

      // Create payment record
      const record: CreatePaymentRecord = {
        transactionId,
        orderId: paymentResponse.data.txnmode,
        merchantId,
        merchantMobileNo,
        amount,
        paymentMethod: 'ORANGE',
        status: paymentResponse.data.status,
        currency,
        customerPhone,
        GSI1SK: Math.floor(Date.now() / 1000),
        GSI2SK: Math.floor(Date.now() / 1000),
        exchangeRate: 'N/A',
        processingFee: feeAmount.toString(),
        netAmount: (amount - feeAmount).toString(),
        externalTransactionId: paymentResponse.data.txnmode,
        uniqueId: payToken,
        fee: feeAmount,
        settlementAmount: amount - feeAmount,
        transactionType: 'CHARGE',
        metaData: {
          ...metaData,
          payToken,
          txnid: paymentResponse.data.txnid
        }
      };

      await this.dbService.createPaymentRecord(record);
      
      // Publish status to SNS
      await this.publishTransactionStatus({
        transactionId,
        status: paymentResponse.data.status,
        type: 'CREATE',
        amount,
        merchantId,
        transactionType: 'CHARGE',
        metaData,
        fee: feeAmount,
        customerPhone,
        currency
      });

      return {
        transactionId,
        status: paymentResponse.data.status
      };
    } catch (error) {
      this.logger.error('Error processing Orange Money charge', {
        error: error instanceof Error ? error.message : 'Unknown error',
        amount,
        customerPhone
      });

      // Create failed payment record
      const failedRecord: CreatePaymentRecord = {
        transactionId,
        merchantId,
        amount,
        paymentMethod: 'ORANGE',
        status: 'FAILED',
        paymentProviderResponse: {
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'FAILED',
          timestamp: Math.floor(Date.now() / 1000)
        },
        transactionType: 'CHARGE',
        metaData,
        fee: feeAmount,
        uniqueId: transactionId,
        GSI1SK: Math.floor(Date.now() / 1000),
        GSI2SK: Math.floor(Date.now() / 1000),
        exchangeRate: 'N/A',
        processingFee: 'N/A',
        netAmount: 'N/A',
        externalTransactionId: 'N/A'
      };

      await this.dbService.createPaymentRecord(failedRecord);

      // Publish failed status to SNS
      await this.publishTransactionStatus({
        transactionId,
        status: 'FAILED',
        type: 'CREATE',
        amount,
        merchantId,
        transactionType: 'CHARGE',
        metaData,
        fee: feeAmount,
        customerPhone,
        currency
      });

      throw error;
    }
  }

  /**
   * Processes a refund payment (Not implemented yet)
   */
  private async processRefund(
    amount: number,
    payToken: string,
    reason?: string
  ): Promise<{ transactionId: string; status: string }> {
    // This is a placeholder for future implementation
    throw new Error('Orange Money refund functionality is not implemented yet');
  }

  /**
   * Processes a disbursement request from a merchant.
   * Creates a disbursement request via Orange's API and stores the transaction in DynamoDB.
   *
   * @param amount - The disbursement amount
   * @param merchantMobileNo - Merchant's mobile number
   * @param merchantId - ID of the merchant receiving the disbursement
   * @param transactionId - ID of the transaction
   * @param metaData - Optional metadata for the transaction
   * @param currency - Disbursement currency (default: EUR)
   * @returns The transaction ID and status
   */
  public async processDisbursement(
    amount: number,
    merchantMobileNo: string,
    merchantId: string,
    transactionId: string,
    metaData?: Record<string, string>,
    currency: string = 'EUR'
  ): Promise<{ transactionId: string; status: string }> {
    const feePercentage = 0.02;
    const feeAmount = Math.floor(amount * feePercentage);

    try {
      // Initialize disbursement
      const payToken = await this.initiateMerchantPayment();

      // Execute disbursement
      const disbursementResponse = await this.executeDisbursement({
        channelUserMsisdn: this.credentials?.merchantPhone || '',
        amount: amount.toString(),
        subscriberMsisdn: merchantMobileNo,
        orderId: transactionId,
        description: `Disbursement for transaction ${transactionId}`,
        payToken
      });

      // Create disbursement record
      const record: CreatePaymentRecord = {
        transactionId,
        merchantId,
        amount,
        paymentMethod: 'ORANGE',
        status: disbursementResponse.data.status,
        paymentProviderResponse: disbursementResponse,
        transactionType: 'DISBURSEMENT',
        metaData,
        fee: feeAmount,
        uniqueId: payToken,
        GSI1SK: Math.floor(Date.now() / 1000),
        GSI2SK: Math.floor(Date.now() / 1000),
        exchangeRate: 'N/A',
        processingFee: 'N/A',
        netAmount: 'N/A',
        externalTransactionId: 'N/A'
      };

      await this.dbService.createPaymentRecord(record);

      // Publish success status to SNS
      await this.publishTransactionStatus({
        transactionId,
        status: disbursementResponse.data.status,
        type: 'CREATE',
        amount,
        merchantId,
        transactionType: 'DISBURSEMENT',
        metaData,
        fee: feeAmount,
        customerPhone: merchantMobileNo,
        currency
      });

      return {
        transactionId,
        status: disbursementResponse.data.status
      };
    } catch (error) {
      this.logger.error('Error processing disbursement', error);

      // Create failed disbursement record
      const failedRecord: CreatePaymentRecord = {
        transactionId,
        merchantId,
        amount,
        paymentMethod: 'ORANGE',
        status: 'FAILED',
        paymentProviderResponse: {
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'FAILED',
          timestamp: Math.floor(Date.now() / 1000)
        },
        transactionType: 'DISBURSEMENT',
        metaData,
        fee: feeAmount,
        uniqueId: transactionId,
        GSI1SK: Math.floor(Date.now() / 1000),
        GSI2SK: Math.floor(Date.now() / 1000),
        exchangeRate: 'N/A',
        processingFee: 'N/A',
        netAmount: 'N/A',
        externalTransactionId: 'N/A'
      };

      await this.dbService.createPaymentRecord(failedRecord);

      // Publish failed status to SNS
      await this.publishTransactionStatus({
        transactionId,
        status: 'FAILED',
        type: 'CREATE',
        amount,
        merchantId,
        transactionType: 'DISBURSEMENT',
        metaData,
        fee: feeAmount,
        customerPhone: merchantMobileNo,
        currency
      });

      throw error;
    }
  }
}
