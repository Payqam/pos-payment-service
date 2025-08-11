import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';
import { CreatePaymentRecord, SNSMessage, UpdatePaymentRecord } from '../../../model';
import { v4 as uuidv4 } from 'uuid';
import axios, { AxiosInstance } from 'axios';
import querystring from 'querystring';
import {
  OrangeToken,
  PaymentInitResponse,
  PaymentResponse,
} from '../../../model';
import { OrangePaymentStatus } from '../../../types/orange';
import { TEST_NUMBERS, PAYMENT_SCENARIOS } from '../../../../configurations/sandbox/orange';
import { EnhancedError, ErrorCategory } from '../../../../utils/errorHandler';

/**
 * Orange API credentials structure
 */
interface OrangeCredentials {
  targetEnvironment: string;
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  xAuthToken: string;
  notifyUrl: string;
  merchantPhone: string;
  merchantPin: string;
  chargeWebhookUrl: string;
  refundWebhookUrl: string;
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
    LoggerService.setLevel('debug');
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
      targetEnvironment: secret.targetEnvironment,
      chargeWebhookUrl: secret.chargeWebhookUrl,
      refundWebhookUrl: secret.refundWebhookUrl,
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
      if (
        this.currentToken &&
        currentTime < this.tokenExpiryTime - this.TOKEN_EXPIRY_BUFFER
      ) {
        this.logger.info('Using cached token');
        return this.currentToken;
      }

      const credentials = await this.getOrangeCredentials();

      const response = await axios.post(
        credentials.tokenUrl,
        querystring.stringify({
          grant_type: 'client_credentials',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials.clientId}`,
          },
        }
      );

      const token: OrangeToken = response.data;

      // Store token and calculate expiry time with buffer
      this.currentToken = token;
      this.tokenExpiryTime = currentTime + token.expires_in;

      this.logger.info('Generated new Orange token', {
        expiresIn: token.expires_in,
        tokenType: token.token_type,
        expiryTime: this.tokenExpiryTime,
      });

      return token;
    } catch (error) {
      this.logger.error('Error generating Orange token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenUrl: (await this.getOrangeCredentials()).tokenUrl,
      });
      throw new EnhancedError(
        'ORANGE_TOKEN_ERROR',
        ErrorCategory.PROVIDER_ERROR,
        'Failed to generate Orange token',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check Orange API credentials and connectivity',
        }
      );
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
        if (
          axios.isAxiosError(error) &&
          error.response?.status === 401 &&
          attempt < this.MAX_RETRIES
        ) {
          this.logger.warn(
            `Token expired, attempt ${attempt}/${this.MAX_RETRIES}. Refreshing token...`
          );

          // Force token refresh
          this.currentToken = null;
          this.tokenExpiryTime = 0;

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));
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
      accept: 'application/json',
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
          confirmtxnstatus: response.data.data.confirmtxnstatus,
        });

        return response.data;
      } catch (error) {
        this.logger.error('Error checking payment status', {
          error: error instanceof Error ? error.message : 'Unknown error',
          payToken,
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
          payToken: response.data.data.payToken,
        });

        return response.data.data.payToken;
      } catch (error) {
        this.logger.error('Error initiating merchant payment', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw new EnhancedError(
          'MERCHANT_PAYMENT_INIT_FAILED',
          ErrorCategory.PROVIDER_ERROR,
          'Failed to initiate merchant payment',
          {
            originalError: error,
            retryable: true,
            suggestedAction: 'Check Orange API connectivity and credentials',
          }
        );
      }
    });
  }

  /**
   * Initiates a cashin transaction for disbursement or refund
   * @returns PaymentInitResponse with payToken
   */
  public async initiateCashinTransaction(): Promise<PaymentInitResponse> {
    return this.executeWithRetry(async () => {
      try {
        const headers = await this.createHeaders();

        const response = await axios.post(
          `${(await this.getOrangeCredentials()).baseUrl}/omapi/1.0.2/cashin/init`,
          {},
          { headers }
        );

        return response.data;
      } catch (error) {
        this.logger.error('Error initiating cashin transaction', { error });
        throw new EnhancedError(
          'CASHIN_INIT_FAILED',
          ErrorCategory.PROVIDER_ERROR,
          'Failed to initiate cashin transaction',
          {
            originalError: error,
            retryable: true,
            suggestedAction: 'Check Orange API connectivity and credentials',
          }
        );
      }
    });
  }

  /**
   * Executes a cashin payment for disbursement or refund
   * @param params Payment parameters including amount, subscriber details, and description
   * @returns PaymentResponse
   */
  public async executeCashinPayment(params: {
    channelUserMsisdn: string;
    amount: string;
    subscriberMsisdn: string;
    orderId: string;
    description: string;
    payToken: string;
  }): Promise<PaymentResponse> {
    return this.executeWithRetry(async () => {
      try {
        const headers = await this.createHeaders();

        const response = await axios.post(
          `${(await this.getOrangeCredentials()).baseUrl}/omapi/1.0.2/cashin/pay`,
          {
            ...params,
            pin: (await this.getOrangeCredentials()).merchantPin,
          },
          { headers }
        );

        return response.data;
      } catch (error) {
        this.logger.error('Error executing cashin payment', {
          error: error instanceof Error ? error.message : 'Unknown error',
          params: {
            ...params,
            pin: '[REDACTED]',
          },
        });
        throw new EnhancedError(
          'CASHIN_PAYMENT_FAILED',
          ErrorCategory.PROVIDER_ERROR,
          'Failed to execute cashin payment',
          {
            originalError: error,
            retryable: true,
            suggestedAction: 'Check payment parameters and try again',
          }
        );
      }
    });
  }

  /**
   * Executes a merchant payment transaction
   * @param params Payment parameters including amount, subscriber details, and description
   * @returns PaymentResponse
   */
  private async executeMerchantPayment(params: {
    channelUserMsisdn: string;
    amount: string;
    subscriberMsisdn: string;
    orderId: string;
    description: string;
    payToken: string;
    notifyUrl: string;
  }): Promise<PaymentResponse> {
    return this.executeWithRetry(async () => {
      try {
        const credentials = await this.getOrangeCredentials();
        const axiosInstance = await this.createAxiosInstance();

        const response = await axiosInstance.post<PaymentResponse>(
          '/omapi/1.0.2/mp/pay',
          {
            notifUrl: params.notifyUrl,
            channelUserMsisdn: params.channelUserMsisdn,
            amount: params.amount,
            subscriberMsisdn: params.subscriberMsisdn,
            pin: credentials.merchantPin,
            orderId: params.orderId,
            description: params.description,
            payToken: params.payToken,
          }
        );

        this.logger.info('Merchant payment execution successful', {
          orderId: params.orderId,
          payToken: params.payToken,
          status: response.data.data.status,
          txnid: response.data.data.txnid,
        });

        // Return the PaymentResponse data, not the full Axios response
        return response.data;
      } catch (error) {
        this.logger.error('Error executing merchant payment', {
          error: error instanceof Error ? error.message : 'Unknown error',
          params,
        });
        throw error;
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
    const uniqueNumber = String(Math.floor(Math.random() * 10000)).padStart(
      4,
      '0'
    );

    return `${prefix}${year}${month}${day}${uniqueNumber}`.slice(0, 20);
  }

  /**
   * Publishes a transaction status update to SNS
   */
  private async publishTransactionStatus(params: {
    transactionId: string;
    paymentMethod: string;
    status: string;
    type: string;
    amount: number;
    merchantId: string;
    transactionType: string;
    metaData?: Record<string, string>;
    fee: number;
    createdOn?: string;
    customerPhone?: string;
    currency?: string;
    exchangeRate?: string;
    processingFee?: string;
    netAmount?: string;
    externalTransactionId?: string;
    settlementAmount?: string;
    merchantMobileNo?: string;
    originalTransactionId?: string;
  }) {
    this.logger.info('Publishing transaction status to SNS', params);
    const dateTime = new Date().toISOString();
    const timestamp = Math.floor(new Date(dateTime).getTime() / 1000);
    await this.snsService.publish({
      transactionId: params.transactionId,
      originalTransactionId: params.originalTransactionId,
      paymentMethod: params.paymentMethod,
      status: params.status,
      amount: params.amount.toString(),
      merchantId: params.merchantId,
      transactionType: params.transactionType,
      metaData: params.metaData,
      fee: params.fee.toString(),
      createdOn: params.createdOn || timestamp,
      customerPhone: params.customerPhone,
      currency: params.currency || 'EUR',
      exchangeRate: params.exchangeRate || 'N/A',
      processingFee: params.processingFee || 'N/A',
      netAmount: params.netAmount || 'N/A',
      externalTransactionId: params.externalTransactionId || 'N/A',
      settlementAmount: params.settlementAmount || 'N/A',
      merchantMobileNo: params.merchantMobileNo
    } as SNSMessage);
  }

  /**
   * Makes a webhook call for sandbox testing
   * @param params - Webhook parameters
   * @param webhookUrl - URL to call
   */
  private async callWebhook(
    params: {
      payToken: string;
    },
    webhookUrl: string
  ): Promise<void> {
    try {
      const axiosInstance = await this.createAxiosInstance();
      await axiosInstance.post(webhookUrl, {
        type: 'payment_notification',
        data: params,
      });
    } catch (error) {
      this.logger.error('Error calling webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
        params,
        webhookUrl,
      });
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

    this.logger.info('Orange Money charge initiated', { amount, customerPhone, merchantId, merchantMobileNo, metaData, currency });

    const transactionId = uuidv4();
    const feePercentage = 0.02;
    const feeAmount = Math.floor(amount * feePercentage);

    try {
      // Initialize payment
      const payToken = await this.initiateMerchantPayment();
      const orderId = this.generateOrderId('CH'); // Using CH prefix for charges
      const credentials = await this.getOrangeCredentials();

      // Execute payment
      const paymentResponse = await this.executeMerchantPayment({
        channelUserMsisdn: credentials.merchantPhone,
        amount: amount.toString(),
        subscriberMsisdn: customerPhone,
        orderId,
        description: metaData?.description || 'PayQam payment',
        payToken,
        notifyUrl: credentials.notifyUrl,
      });

      this.logger.info('Orange Money charge execution response', {
        orderId,
        payToken,
        response: {
          status: paymentResponse.data.status,
          txnid: paymentResponse.data.txnid,
          txnmode: paymentResponse.data.txnmode,
          subscriberMsisdn: paymentResponse.data.subscriberMsisdn,
          amount: paymentResponse.data.amount,
          channelUserMsisdn: paymentResponse.data.channelUserMsisdn,
          description: paymentResponse.data.description,
          createtime: paymentResponse.data.createtime,
        },
      });

      // Create payment record
      const record: CreatePaymentRecord = {
        transactionId,
        orderId,
        merchantId,
        merchantMobileNo,
        amount,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.PAYMENT_REQUEST_CREATED,
        currency,
        customerPhone,
        chargeMpResponse: paymentResponse.data,
        transactionType: 'CHARGE',
        metaData: {
          ...metaData,
          payToken,
          txnid: paymentResponse.data.txnid,
        },
        uniqueId: payToken,
        GSI1SK: Math.floor(Date.now() / 1000),
        GSI2SK: Math.floor(Date.now() / 1000),
        exchangeRate: 'N/A',
        processingFee: feeAmount.toString(),
        netAmount: (amount - feeAmount).toString(),
        externalTransactionId: paymentResponse.data.txnid,
        fee: feeAmount,
        settlementAmount: amount - feeAmount,
      };

      await this.dbService.createPaymentRecord(record);

      // Publish status to SNS
      await this.publishTransactionStatus({
        transactionId,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.PAYMENT_REQUEST_CREATED,
        type: 'CREATE',
        amount,
        merchantId,
        transactionType: 'CHARGE',
        metaData: record.metaData,
        fee: feeAmount,
        customerPhone,
        currency,
        createdOn: new Date().toISOString(),
        settlementAmount: (amount - feeAmount).toString(),
        externalTransactionId: paymentResponse.data.txnid,
        merchantMobileNo: merchantMobileNo
      });

      // Check if we're in sandbox environment
      if (credentials.targetEnvironment === 'sandbox') {
        await this.callWebhook(
          {
            payToken: payToken,
          },
          credentials.chargeWebhookUrl
        );
      }

      return {
        transactionId,
        status: OrangePaymentStatus.PAYMENT_REQUEST_CREATED,
      };
    } catch (error) {
      this.logger.error('Error processing Orange Money charge', {
        error: error instanceof Error ? error.message : 'Unknown error',
        amount,
        customerPhone,
      });

      // Create failed payment record
      const failedRecord: CreatePaymentRecord = {
        transactionId,
        merchantId,
        amount,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.PAYMENT_FAILED,
        chargeMpResponse: {
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'FAILED',
          timestamp: Math.floor(Date.now() / 1000),
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
        externalTransactionId: 'N/A',
      };

      await this.dbService.createPaymentRecord(failedRecord);

      // Publish failed status to SNS
      await this.publishTransactionStatus({
        transactionId,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.PAYMENT_FAILED,
        type: 'CREATE',
        amount,
        merchantId,
        transactionType: 'CHARGE',
        metaData,
        fee: feeAmount,
        customerPhone,
        currency,
        createdOn: new Date().toISOString(),
        settlementAmount: amount.toString(),
        externalTransactionId: 'N/A',
        merchantMobileNo: merchantMobileNo
      });

      throw error;
    }
  }

  /**
   * Processes a refund payment
   * @param amount - The refund amount
   * @param customerPhone - Customer's phone number
   * @param merchantId - ID of the merchant
   * @param merchantMobileNo - Merchant's mobile number
   * @param transactionId - Optional ID of the transaction to refund
   * @param metaData - Optional metadata for the transaction
   * @param currency - Refund currency (default: EUR)
   */
  private async processRefund(
    amount: number,
    customerPhone: string,
    merchantId: string,
    merchantMobileNo: string,
    transactionId?: string,
    metaData?: Record<string, never> | Record<string, string>,
    currency: string = 'EUR'
  ): Promise<{ transactionId: string; status: string; message?: string }> {
    if (!transactionId) {
      const error = new Error('Transaction ID is required for refund');
      this.logger.error(
        'Error processing Orange Money refund: Missing transaction ID',
        {
          amount,
          customerPhone,
          merchantId,
        }
      );
      throw error;
    }

    let existingTransaction;

    // Check if transaction exists and its status
    try {
      const existingTransactionResult = await this.dbService.getItem(
        { transactionId },
        'TransactionIndex'
      );

      existingTransaction = existingTransactionResult.Item;

      if (!existingTransaction) {
        this.logger.warn('Transaction not found for refund', { transactionId });
        return {
          transactionId,
          status: 'FAILED',
          message: `Transaction not found with ID: ${transactionId}`,
        };
      }

      // // Check if it's already a successful refund
      if (
        existingTransaction.transactionType === 'REFUND' &&
        existingTransaction.amount ===
        0
      ) {
        return {
          transactionId,
          status: 'ALREADY_REFUNDED',
          message: 'Transaction has already been fully refunded',
        };
      }

      // Validate refund amount against original payment amount
      if (amount > existingTransaction.amount) {
        this.logger.warn('Refund amount exceeds original payment amount', {
          refundAmount: amount,
          originalAmount: existingTransaction.amount,
          transactionId,
        });
        return {
          transactionId,
          status: 'FAILED',
          message: `Refund amount (${amount}) cannot exceed original payment amount (${existingTransaction.amount})`,
        };
      }

      this.logger.info('Found existing transaction', {
        transactionId,
        type: existingTransaction.transactionType,
        status: existingTransaction.status,
      });



      // Check if the original transaction exists and was successful
      // if (existingTransaction.transactionType === 'CHARGE' &&
      //     existingTransaction.status !== 'SUCCESSFULL') {
      //   throw new Error('Original transaction was not successful');
      // }

      // TODO: Temporary check for PENDING transactions
      if (
        existingTransaction.transactionType === 'CHARGE' &&
        existingTransaction.status !== OrangePaymentStatus.PAYMENT_SUCCESSFUL
      ) {
        throw new Error('Original transaction was not successful');
      }
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        this.logger.warn('Transaction not found for refund', {
          transactionId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return {
          transactionId,
          status: 'FAILED',
          message: `Transaction not found with ID: ${transactionId}`,
        };
      }
      throw error;
    }

    this.logger.info('Processing Orange Money refund', {
      transactionId,
      amount,
      customerPhone,
      merchantId,
      merchantMobileNo,
      currency,
    });

    let merchantPayOrderId = '';

    try {
      // Step 1: Initialize refund cashin
      const initResponse = await this.initiateCashinTransaction();
      const refundPayToken = initResponse.data.payToken;

      // Step 2: Execute refund cashin payment
      const credentials = await this.getOrangeCredentials();
      const refundOrderId = this.generateOrderId('RF'); // Using RF prefix for refunds

      // const refundResponse = await this.executeCashinPayment({
      //   channelUserMsisdn: credentials.merchantPhone,
      //   amount: amount.toString(),
      //   subscriberMsisdn: customerPhone,
      //   orderId: refundOrderId,
      //   description: metaData?.reason || 'PayQam refund',
      //   payToken: refundPayToken,
      // });

      const refundResponse: PaymentResponse = {
        message: 'Payment successful',
        data: {
          status: OrangePaymentStatus.PAYMENT_SUCCESSFUL,
          payToken: refundPayToken,
          amount: amount,
          subscriberMsisdn: customerPhone,
          txnmode: refundOrderId,
          description: metaData?.reason || 'PayQam refund',
          createtime: new Date().toISOString(),
          channelUserMsisdn: credentials.merchantPhone,
          notifUrl: credentials.notifyUrl,
          id: 0,
          txnid: '',
          inittxnstatus: '',
          inittxnmessage: '',
          confirmtxnstatus: '',
          confirmtxnmessage: '',
        },
      };

      // Check if we're in sandbox environment
      if (credentials.targetEnvironment === 'sandbox') {
        const subscriberMsisdn = refundResponse.data.subscriberMsisdn;

        // Override payment status based on test phone numbers
        const scenarioKey = Object.entries(TEST_NUMBERS.PAYMENT_SCENARIOS).find(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ([_, number]) => number === subscriberMsisdn
        )?.[0];

        if (scenarioKey && scenarioKey in PAYMENT_SCENARIOS) {
          const scenario =
            PAYMENT_SCENARIOS[scenarioKey as keyof typeof PAYMENT_SCENARIOS];
          refundResponse.data.status = scenario.status;
        }
      }

      this.logger.info('Orange Money refund cashin execution response', {
        transactionId,
        orderId: refundOrderId,
        payToken: refundPayToken,
        response: {
          status: refundResponse.data.status,
          txnid: refundResponse.data.txnid,
          txnmode: refundResponse.data.txnmode,
          subscriberMsisdn: refundResponse.data.subscriberMsisdn,
          amount: refundResponse.data.amount,
          channelUserMsisdn: refundResponse.data.channelUserMsisdn,
          description: refundResponse.data.description,
          createtime: refundResponse.data.createtime,
        },
      });

      const refundCashinResponsePayload: UpdatePaymentRecord = {
        refundCashinResponse: refundResponse.data,
      };

      await this.dbService.updatePaymentRecord(
        { transactionId },
        refundCashinResponsePayload
      );

      // Step 3: Initiate merchant payment
      const merchantPayToken = await this.initiateMerchantPayment();
      merchantPayOrderId = this.generateOrderId('MP'); // Using MP prefix for merchant payments

      // Step 4: Execute merchant payment
      const merchantPayResponse = await this.executeMerchantPayment({
        channelUserMsisdn: credentials.merchantPhone,
        amount: amount.toString(),
        subscriberMsisdn: merchantMobileNo,
        orderId: merchantPayOrderId,
        description: `Refund payment for ${transactionId}`,
        payToken: merchantPayToken,
        notifyUrl: credentials.notifyUrl,
      });

      this.logger.info('Orange Money merchant payment execution response', {
        transactionId,
        orderId: merchantPayOrderId,
        payToken: merchantPayToken,
        response: {
          status: merchantPayResponse.data.status,
          txnid: merchantPayResponse.data.txnid,
          txnmode: merchantPayResponse.data.txnmode,
          subscriberMsisdn: merchantPayResponse.data.subscriberMsisdn,
          amount: merchantPayResponse.data.amount,
          channelUserMsisdn: merchantPayResponse.data.channelUserMsisdn,
          description: merchantPayResponse.data.description,
          createtime: merchantPayResponse.data.createtime,
        },
      });

      // Update refund record
      const record: UpdatePaymentRecord = {
        orderId: refundOrderId,
        merchantId,
        merchantMobileNo,
        amount: existingTransaction.amount - amount,
        paymentMethod: 'ORANGE',
        status: refundResponse.data.status,
        currency,
        customerPhone,
        refundMpResponse: merchantPayResponse.data,
        transactionType: 'REFUND',
        metaData: {
          ...metaData,
          refundPayToken,
          merchantPayToken,
          refundOrderId,
          merchantPayOrderId,
          originalTransactionId: transactionId,
        },
        merchantRefundId: merchantPayToken,
        GSI1SK: Math.floor(Date.now() / 1000),
        GSI2SK: Math.floor(Date.now() / 1000),
        exchangeRate: 'N/A',
        processingFee: '0',
        netAmount: amount.toString(),
        externalTransactionId: refundResponse.data.txnid,
        fee: 0,
        settlementAmount: amount,
      };

      await this.dbService.updatePaymentRecord({ transactionId }, record);

      // Check if we're in sandbox environment
      if (credentials.targetEnvironment === 'sandbox') {
        await this.callWebhook(
          {
            payToken: merchantPayToken,
          },
          credentials.refundWebhookUrl
        );
      }

      // Publish status to SNS
      await this.publishTransactionStatus({
        transactionId,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.MERCHANT_REFUND_REQUEST_CREATED,
        type: 'UPDATE',
        amount: existingTransaction.amount - amount,
        merchantId,
        transactionType: 'REFUND',
        metaData: {},
        fee: existingTransaction.fee,
        customerPhone,
        currency,
        createdOn: new Date().toISOString(),
        settlementAmount: amount.toString(),
        merchantMobileNo: merchantMobileNo
      });

      await this.publishTransactionStatus({
        transactionId: merchantPayOrderId,
        originalTransactionId: transactionId,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.MERCHANT_REFUND_REQUEST_CREATED,
        type: 'UPDATE',
        amount,
        merchantId,
        transactionType: 'REFUND',
        metaData: {},
        fee: 0,
        customerPhone,
        currency,
        createdOn: new Date().toISOString(),
        settlementAmount: amount.toString(),
        merchantMobileNo: merchantMobileNo
      });

      return {
        transactionId,
        status: OrangePaymentStatus.CUSTOMER_REFUND_REQUEST_CREATED,
      };
    } catch (error) {
      this.logger.error('Error processing Orange Money refund', {
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId,
        amount,
        customerPhone,
      });

      // Update failed refund record
      const failedRecord: UpdatePaymentRecord = {
        status: 'FAILED',
        refundMpResponse: {
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'FAILED',
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      await this.dbService.updatePaymentRecord({ transactionId }, failedRecord);

      // Publish failed status to SNS
      await this.publishTransactionStatus({
        transactionId,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.MERCHANT_REFUND_FAILED,
        type: 'UPDATE',
        amount,
        merchantId,
        transactionType: 'REFUND',
        metaData,
        fee: 0,
        customerPhone,
        currency,
        createdOn: new Date().toISOString(),
        settlementAmount: amount.toString(),
        externalTransactionId: 'N/A',
        merchantMobileNo: merchantMobileNo
      });

      await this.publishTransactionStatus({
        transactionId: merchantPayOrderId,
        originalTransactionId: transactionId,
        paymentMethod: 'ORANGE',
        status: OrangePaymentStatus.MERCHANT_REFUND_FAILED,
        type: 'UPDATE',
        amount,
        merchantId,
        transactionType: 'REFUND',
        metaData: {},
        fee: 0,
        customerPhone,
        currency,
        createdOn: new Date().toISOString(),
        settlementAmount: amount.toString(),
        merchantMobileNo: merchantMobileNo
      });

      throw error;
    }
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
   * @param transactionId
   * @returns The transaction ID and status
   */
  public async processPayment(
    amount: number,
    customerPhone: string,
    merchantId: string,
    merchantMobileNo: string,
    metaData?: Record<string, never> | Record<string, string>,
    transactionType: string = 'CHARGE',
    currency: string = 'EUR',
    transactionId?: string
  ): Promise<{ transactionId: string; status: string }> {
    this.logger.info('Processing Orange Money payment', {
      amount,
      customerPhone,
      transactionType,
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
        return this.processRefund(
          amount,
          customerPhone,
          merchantId,
          merchantMobileNo,
          transactionId,
          metaData,
          currency
        );
      }

      default: {
        throw new EnhancedError(
          'UNSUPPORTED_TRANSACTION_TYPE',
          ErrorCategory.VALIDATION_ERROR,
          `Unsupported transaction type: ${transactionType}`,
          {
            retryable: false,
            suggestedAction:
              'Use a supported transaction type (CHARGE or REFUND)',
          }
        );
      }
    }
  }
}
