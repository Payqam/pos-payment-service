import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { CreatePaymentRecord } from '../../../model';
import { MTNPaymentStatus, WebhookEvent } from '../../../types/mtn';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { SNSService } from '../../../services/snsService';
import * as process from 'node:process';
import { EnhancedError, ErrorCategory } from '../../../../utils/errorHandler';
import {
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  executeWithRetry,
  createRetryableAxiosInstance,
} from '../../../../utils/retryUtils';

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
  CUSTOMER_REFUND = 'customer_refund',
  MERCHANT_REFUND = 'merchant_refund',
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

  private readonly snsService: SNSService;

  private readonly retryConfig: RetryConfig;

  constructor() {
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.baseUrl =
      process.env.MTN_API_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      logger: this.logger,
      maxRetries: parseInt(process.env.MTN_API_MAX_RETRIES || '5', 10),
      baseDelayMs: parseInt(process.env.MTN_API_BASE_DELAY_MS || '100', 10),
      maxDelayMs: parseInt(process.env.MTN_API_MAX_DELAY_MS || '30000', 10),
    };
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
    const fee = amount * feePercentage; // Keep the exact decimal value
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
        type === TransactionType.PAYMENT ||
        type === TransactionType.MERCHANT_REFUND
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

    // Add reference ID if provided
    if (transactionId) headers['X-Reference-Id'] = transactionId;

    // Add callback URL based on transaction type
    if (type === TransactionType.PAYMENT) {
      headers['X-Callback-Url'] = process.env.MTN_PAYMENT_WEBHOOK_URL as string;
    } else if (type === TransactionType.TRANSFER) {
      headers['X-Callback-Url'] = process.env
        .MTN_DISBURSEMENT_WEBHOOK_URL as string;
    } else if (type === TransactionType.CUSTOMER_REFUND) {
      headers['X-Callback-Url'] = process.env
        .MTN_CUSTOMER_REFUND_WEBHOOK_URL as string;
    } else {
      headers['X-Callback-Url'] = process.env
        .MTN_MERCHANT_REFUND_WEBHOOK_URL as string;
    }
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
  async createAxiosInstance(
    type: TransactionType,
    transactionId?: string
  ): Promise<AxiosInstance> {
    const credentials = await this.getMTNCredentials();
    const token = await this.generateToken(credentials, type);

    const axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: this.createHeaders(type, credentials, token, transactionId),
    });

    // Enhance the axios instance with retry capability
    return createRetryableAxiosInstance(axiosInstance, {
      ...this.retryConfig,
      // Add transaction context to logs
      logger: {
        ...this.logger,
        warn: (message: string, data?: any) =>
          this.logger.warn(message, {
            ...data,
            transactionType: type,
            transactionId: transactionId || 'none',
          }),
        error: (message: string, data?: any) =>
          this.logger.error(message, {
            ...data,
            transactionType: type,
            transactionId: transactionId || 'none',
          }),
        info: (message: string, data?: any) =>
          this.logger.info(message, {
            ...data,
            transactionType: type,
            transactionId: transactionId || 'none',
          }),
        debug: (message: string, data?: any) =>
          this.logger.debug(message, {
            ...data,
            transactionType: type,
            transactionId: transactionId || 'none',
          }),
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
    const apiPath =
      type === TransactionType.PAYMENT ||
      type === TransactionType.MERCHANT_REFUND
        ? '/collection/token/'
        : '/disbursement/token/';
    // Log the transaction type and API path being used
    this.logger.debug('Generating MTN token', {
      type,
      apiPath,
      baseURL: this.baseUrl,
    });

    const creds =
      type === TransactionType.PAYMENT ||
      type === TransactionType.MERCHANT_REFUND
        ? credentials.collection
        : credentials.disbursement;

    // Log credential information (without sensitive data)
    this.logger.debug('Using credentials', {
      apiUser: creds.apiUser,
      hasApiKey: !!creds.apiKey,
      hasSubscriptionKey: !!creds.subscriptionKey,
      targetEnvironment: credentials.targetEnvironment,
    });

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

    // Log the request configuration (without sensitive data)
    this.logger.debug('Token request configuration', {
      url: `${this.baseUrl}${apiPath}`,
      method: 'POST',
      headers: {
        'Content-Type': config.headers['Content-Type'],
        'Ocp-Apim-Subscription-Key': config.headers['Ocp-Apim-Subscription-Key']
          ? '[PRESENT]'
          : '[MISSING]',
      },
      auth: {
        username: config.auth.username,
        password: config.auth.password ? '[PRESENT]' : '[MISSING]',
      },
    });

    try {
      // Use executeWithRetry to handle token generation with retries
      const response = await executeWithRetry(
        () => axios.post(apiPath, {}, config),
        {
          ...this.retryConfig,
          // Add custom retry logic for rate limiting
          shouldRetry: (error) => {
            // Always retry on network errors
            if (!error.response) return true;

            // For 429 errors, extract retry time from response
            if (error.response.status === 429) {
              // Check for Retry-After header
              const retryAfter = error.response.headers['retry-after'];
              if (retryAfter) {
                // Convert to milliseconds and use as delay
                const retryDelayMs = parseInt(retryAfter, 10) * 1000;
                error.retryDelay = retryDelayMs;
                return true;
              }

              // Try to extract retry time from error message
              const message = error.response.data?.message;
              if (message) {
                const match = message.match(/Try again in (\d+) seconds/);
                if (match && match[1]) {
                  const retryDelayMs = parseInt(match[1], 10) * 1000;
                  error.retryDelay = retryDelayMs;
                  return true;
                }
              }
            }

            // Use default retry logic for other status codes
            return (
              error.response.status >= 500 || error.response.status === 429
            );
          },
          // Use custom delay calculation that respects rate limit instructions
          calculateDelay: (attempt, error) => {
            // If we extracted a retry delay from the response, use it
            if (error.retryDelay) {
              return error.retryDelay;
            }

            // Otherwise use exponential backoff
            return Math.min(
              this.retryConfig.maxDelayMs,
              this.retryConfig.baseDelayMs * Math.pow(2, attempt)
            );
          },
        },
        'MTN token generation',
        'MTN_TOKEN_ERROR',
        ErrorCategory.PROVIDER_ERROR,
        'Failed to generate MTN token',
        { type, baseURL: this.baseUrl }
      );

      // Log the response status and headers
      this.logger.debug('Token response received', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      // Only log scalar values from the token response
      this.logger.info('Successfully generated MTN token', {
        tokenType: response.data.token_type,
        expiresIn: response.data.expires_in,
      });

      return response.data;
    } catch (error: any) {
      // Enhanced error logging with more details
      const errorObj: any = {
        error: error instanceof Error ? error.message : 'Unknown error',
        type,
        baseURL: this.baseUrl,
      };

      // Add axios error details if available
      if (error.isAxiosError) {
        errorObj.status = error.response?.status;
        errorObj.statusText = error.response?.statusText;
        errorObj.responseData = error.response?.data;
        errorObj.responseHeaders = error.response?.headers;
        errorObj.requestUrl = `${this.baseUrl}${error.config?.url || ''}`;
        errorObj.requestMethod = error.config?.method;
        errorObj.requestHeaders = {
          'Content-Type': error.config?.headers?.['Content-Type'],
          'Ocp-Apim-Subscription-Key': error.config?.headers?.[
            'Ocp-Apim-Subscription-Key'
          ]
            ? '[PRESENT]'
            : '[MISSING]',
        };
        errorObj.hasAuth = !!(
          error.config?.auth?.username && error.config?.auth?.password
        );
      }

      this.logger.error('Error generating MTN token', errorObj);
      throw new EnhancedError(
        'MTN_TOKEN_ERROR',
        ErrorCategory.PROVIDER_ERROR,
        'Failed to generate MTN token',
        error
      );
    }
  }

  /**
   * Calls a webhook for sandbox testing
   * @param event - Webhook Event
   * @param type - Transaction type (PAYMENT or TRANSFER)
   * @returns Promise<void>
   */
  public async callWebhook(
    event: WebhookEvent,
    type: TransactionType
  ): Promise<void> {
    const environment = process.env.MTN_TARGET_ENVIRONMENT;
    if (environment !== 'sandbox') {
      return;
    }
    let webhookUrl = process.env.MTN_PAYMENT_WEBHOOK_URL;
    if (type === TransactionType.TRANSFER)
      webhookUrl = process.env.MTN_DISBURSEMENT_WEBHOOK_URL;
    else if (type === TransactionType.CUSTOMER_REFUND)
      webhookUrl = process.env.MTN_CUSTOMER_REFUND_WEBHOOK_URL;
    else if (type === TransactionType.MERCHANT_REFUND)
      webhookUrl = process.env.MTN_MERCHANT_REFUND_WEBHOOK_URL;

    if (!webhookUrl) {
      return;
    }

    try {
      // Parse the URL to determine if it's HTTP or HTTPS
      const url = new URL(webhookUrl as string);
      const isHttps = url.protocol === 'https:';

      // Create options for the request
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(JSON.stringify(event)),
        },
      };

      // Create a promise to handle the async request
      await new Promise((resolve, reject) => {
        const req = (isHttps ? https : http).request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            resolve(data);
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        // Write the data and end the request
        req.write(JSON.stringify(event));
        req.end();
      });
    } catch (error) {
      this.logger.info('Failed to call the webhook');
      throw new EnhancedError(
        'WEBHOOK_CALL_FAILED',
        ErrorCategory.PROVIDER_ERROR,
        'Failed to call the webhook',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check webhook URL configuration and try again',
          transactionId: event.externalId,
        }
      );
    }
  }

  /**
   * Processes a payment request from a customer.
   * Creates a payment request via MTN's collection API and stores the transaction in DynamoDB.
   *
   * @param transactionId
   * @param amount - The payment amount
   * @param transactionType
   * @param mobileNo - Customer's mobile number (MSISDN format)
   * @param merchantId - ID of the merchant receiving the payment
   * @param merchantMobileNo - Merchant's mobile number for disbursement
   * @param metaData - Optional metadata for the transaction
   * @param currency - Payment currency (default: EUR)
   * @param payerMessage
   * @param payeeNote
   * @returns The transaction ID for tracking
   */
  public async processPayment(
    transactionId: string,
    amount: number,
    transactionType: string,
    mobileNo: string,
    merchantId: string,
    merchantMobileNo: string,
    currency: string,
    payerMessage: string,
    payeeNote: string,
    metaData?: Record<string, never> | Record<string, string>
  ): Promise<{ transactionId: string; status: string } | string> {
    const dateTime = new Date().toISOString();
    switch (transactionType) {
      case 'CHARGE': {
        if (!mobileNo) {
          throw new EnhancedError(
            'MISSING_PHONE',
            ErrorCategory.VALIDATION_ERROR,
            'Missing customer phone number for MTN payment'
          );
        }
        if (!merchantId || !merchantMobileNo) {
          throw new EnhancedError(
            'MISSING_MERCHANT_INFO',
            ErrorCategory.VALIDATION_ERROR,
            'Missing merchant information for MTN payment'
          );
        }
        transactionId = uuidv4();
        const { fee, settlementAmount } =
          this.calculateFeeAndSettlement(amount);
        try {
          const axiosInstance = await this.createAxiosInstance(
            TransactionType.PAYMENT,
            transactionId
          );

          // Create payment request in MTN with retry logic built into the axios instance
          await axiosInstance.post('/collection/v1_0/requesttopay', {
            amount: amount.toString(),
            currency,
            externalId: transactionId,
            payer: {
              partyIdType: 'MSISDN',
              partyId: mobileNo,
            },
            payerMessage,
            payeeNote,
          });

          // Store transaction record in DynamoDB
          const paymentRecord: CreatePaymentRecord = {
            transactionId,
            amount,
            currency,
            paymentMethod: 'MTN',
            status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
            mobileNo,
            merchantId,
            merchantMobileNo,
            metaData,
            fee,
            settlementAmount,
            GSI1SK: Math.floor(new Date(dateTime).getTime() / 1000),
            GSI2SK: Math.floor(new Date(dateTime).getTime() / 1000),
          };

          await this.dbService.createPaymentRecord(paymentRecord);

          await this.snsService.publish({
            transactionId,
            paymentMethod: 'MTN MOMO',
            status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
            type: 'CREATE',
            amount,
            settlementAmount,
            merchantId,
            merchantMobileNo,
            transactionType: 'CHARGE',
            metaData,
            fee: fee,
            createdOn: dateTime,
            customerPhone: mobileNo,
            currency: currency,
            //exchangeRate: 'n/a',
            //processingFee: 'n/a',
            //netAmount: 'n/a',
            //externalTransactionId: 'n/a',
          });

          this.logger.info('Payment request created successfully', {
            transactionId,
            status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
            amount,
            settlementAmount,
          });

          // Check if we're in sandbox environment
          const targetEnvironment = process.env.MTN_TARGET_ENVIRONMENT;
          if (targetEnvironment === 'sandbox') {
            await this.callWebhook(
              {
                financialTransactionId: uuidv4(),
                externalId: transactionId,
                amount: amount as unknown as string,
                currency,
                payer: {
                  partyIdType: 'MSISDN',
                  partyId: mobileNo,
                },
                payerMessage: 'Thank you for your payment',
                payeeNote: 'PayQAM payment request',
                reason: undefined,
                status: 'SUCCESSFUL',
              },
              TransactionType.PAYMENT
            );
          }

          return {
            transactionId,
            status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
          };
        } catch (error) {
          this.logger.error('Failed to process payment', {
            error: error instanceof Error ? error.message : 'Unknown error',
            transactionId,
          });

          await this.snsService.publish({
            transactionId,
            paymentMethod: 'MTN MOMO',
            status: String(MTNPaymentStatus.PAYMENT_FAILED),
            type: 'CREATE',
            amount,
            merchantId,
            transactionType: 'CHARGE',
            metaData,
            fee,
            createdOn: dateTime,
            customerPhone: mobileNo,
            currency: currency,
            //exchangeRate: 'n/a',
            //processingFee: 'n/a',
            //netAmount: 'n/a',
            //externalTransactionId: 'n/a',
          });

          // If not a mapped MTN error, throw the original error
          throw new EnhancedError(
            'PAYMENT_PROCESSING_FAILED',
            ErrorCategory.PROVIDER_ERROR,
            'Failed to process the payment',
            {
              originalError: error,
              retryable: true,
              suggestedAction: 'Check payment details and try again',
              transactionId,
            }
          );
        }
      }

      case 'REFUND': {
        // Get the transaction record from DynamoDB
        const transactionRecord = await this.dbService.getItem({
          transactionId,
        });

        if (!transactionRecord?.Item) {
          throw new EnhancedError(
            'TRANSACTION_NOT_FOUND',
            ErrorCategory.VALIDATION_ERROR,
            'Transaction not found for refund',
            {
              retryable: false,
              suggestedAction: 'Verify the transaction ID and try again',
              transactionId,
            }
          );
        }

        const status = transactionRecord.Item.status;
        // Check if the transaction status allows for refund
        if (status === MTNPaymentStatus.PAYMENT_REQUEST_CREATED) {
          throw new EnhancedError(
            'TRANSACTION_NOT_REFUNDABLE',
            ErrorCategory.VALIDATION_ERROR,
            'Transaction cannot be refunded: Payment not yet successful',
            {
              retryable: false,
              suggestedAction:
                'Ensure the payment is successful before initiating a refund.',
              transactionId,
            }
          );
        }
        if (status === MTNPaymentStatus.PAYMENT_FAILED) {
          throw new EnhancedError(
            'TRANSACTION_NOT_REFUNDABLE',
            ErrorCategory.VALIDATION_ERROR,
            'Transaction cannot be refunded: Payment was unsuccessful',
            {
              retryable: false,
              suggestedAction:
                'Ensure the payment is successful before initiating a refund.',
              transactionId,
            }
          );
        }
        if (
          !amount &&
          status === MTNPaymentStatus.CUSTOMER_REFUND_REQUEST_CREATED
        ) {
          throw new EnhancedError(
            'TRANSACTION_NOT_REFUNDABLE',
            ErrorCategory.VALIDATION_ERROR,
            'Transaction cannot be refunded: Refund request already created',
            {
              retryable: false,
              suggestedAction: 'No further actions are required.',
              transactionId,
            }
          );
        }
        if (!amount && status === MTNPaymentStatus.CUSTOMER_REFUND_SUCCESSFUL) {
          throw new EnhancedError(
            'TRANSACTION_NOT_REFUNDABLE',
            ErrorCategory.VALIDATION_ERROR,
            'The transaction has already been refunded.',
            {
              retryable: false,
              suggestedAction: 'No further actions are required.',
              transactionId,
            }
          );
        }

        // Determine the refund amount
        let refundAmount = amount;

        // If no amount is specified, use the original transaction amount
        if (!refundAmount) {
          refundAmount = transactionRecord.Item.amount;
          this.logger.info('Using original transaction amount for refund', {
            transactionId,
            originalAmount: refundAmount,
          });
        }

        // Get the current total customer refund amount
        const totalCustomerRefundAmount =
          Number(transactionRecord.Item.totalCustomerRefundAmount) || 0;
        this.logger.info('[debug]validations', {
          transactionId,
          totalCustomerRefundAmount,
          refundAmount,
          originalAmount: transactionRecord.Item.amount,
        });
        // Validate that the refund amount doesn't exceed the original transaction amount
        if (
          Number(totalCustomerRefundAmount) + Number(refundAmount) >
          Number(transactionRecord.Item.amount)
        ) {
          throw new EnhancedError(
            'REFUND_AMOUNT_EXCEEDS_ORIGINAL',
            ErrorCategory.VALIDATION_ERROR,
            'Refund amount exceeds the original transaction amount',
            {
              retryable: false,
              suggestedAction:
                'Reduce the refund amount to not exceed the original transaction amount.',
              transactionId,
            }
          );
        }

        // Call the disbursement transfer API to transfer money to the customer
        const customerRefundId = await this.initiateTransfer(
          refundAmount,
          transactionRecord.Item.mobileNo,
          transactionRecord.Item.currency,
          TransactionType.CUSTOMER_REFUND
        );
        // Create a temporary record to associate the transaction with the refund ID
        await this.dbService.createPaymentRecord({
          transactionId: customerRefundId,
          originalTransactionId: transactionRecord.Item.transactionId,
        });
        const updateData = {
          status: String(MTNPaymentStatus.CUSTOMER_REFUND_REQUEST_CREATED),
          customerRefundId: customerRefundId,
          updatedOn: dateTime,
        };
        await this.dbService.updatePaymentRecord({ transactionId }, updateData);
        // Send to SalesForce
        await this.snsService.publish({
          transactionId: transactionRecord.Item.transactionId,
          status: String(MTNPaymentStatus.CUSTOMER_REFUND_REQUEST_CREATED),
          type: 'CREATE',
          createdOn: dateTime,
        });

        // Check if we're in sandbox environment
        const targetEnvironment = process.env.MTN_TARGET_ENVIRONMENT;
        if (targetEnvironment === 'sandbox') {
          await this.callWebhook(
            {
              financialTransactionId: uuidv4(),
              externalId: customerRefundId,
              amount: refundAmount.toString(),
              currency: transactionRecord.Item.currency,
              payee: {
                partyIdType: 'MSISDN',
                partyId: mobileNo,
              },
              payeeNote: `Refund is processed for the transaction ${transactionRecord.Item.transactionId}`,
              payerMessage: 'Your refund is processing. Thank you.',
              reason: undefined,
              status: 'SUCCESSFUL',
            },
            TransactionType.CUSTOMER_REFUND
          );
        }

        return {
          transactionId,
          status: String(MTNPaymentStatus.CUSTOMER_REFUND_REQUEST_CREATED),
        };
      }

      default:
        throw new EnhancedError(
          'UNSUPPORTED_TRANSACTION_TYPE',
          ErrorCategory.VALIDATION_ERROR,
          `Unsupported transaction type: ${transactionType}`,
          {
            retryable: false,
            suggestedAction:
              'Use a supported transaction type (CHARGE or REFUND)',
            transactionId,
          }
        );
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
  ): Promise<WebhookEvent> {
    try {
      const axiosInstance = await this.createAxiosInstance(type);
      const endpoint =
        type === TransactionType.PAYMENT ||
        type === TransactionType.MERCHANT_REFUND
          ? `/collection/v1_0/requesttopay/${transactionId}`
          : `/disbursement/v1_0/transfer/${transactionId}`;

      // The axios instance already has retry logic built in
      const response = await axiosInstance.get(endpoint);
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to check the transaction status', {
        error: error instanceof Error ? error.message : 'Unknown error',
        transactionId,
        type,
      });

      throw new EnhancedError(
        'TRANSACTION_STATUS_CHECK_FAILED',
        ErrorCategory.PROVIDER_ERROR,
        'Failed to check the transaction status',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Retry the status check after a short delay',
          transactionId,
        }
      );
    }
  }

  /**
   * Initiates a transfer to a merchant.
   * Uses MTN's disbursement API to send money to a specified mobile number.
   *
   * @param amount - The amount to transfer
   * @param recipientMobileNo - Recipient's mobile number (MSISDN format)
   * @param currency - Transfer currency (default: EUR)
   * @param transactionType
   * @returns The transfer ID for tracking
   */
  public async initiateTransfer(
    amount: number,
    recipientMobileNo: string,
    currency: string,
    transactionType: TransactionType
  ): Promise<string> {
    try {
      const transactionId = uuidv4();

      const axiosInstance = await this.createAxiosInstance(
        transactionType,
        transactionId
      );

      // The axios instance already has retry logic built in
      await axiosInstance.post('/disbursement/v1_0/transfer', {
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

      return transactionId;
    } catch (error: any) {
      this.logger.error('Failed to initiate transfer', {
        error: error instanceof Error ? error.message : 'Unknown error',
        amount,
        currency,
        recipientMobileNo: recipientMobileNo ? '[PRESENT]' : '[MISSING]',
        transactionType,
      });

      throw new EnhancedError(
        'TRANSFER_INITIATION_FAILED',
        ErrorCategory.PROVIDER_ERROR,
        'Failed to initiate transfer',
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Verify recipient information and try again',
        }
      );
    }
  }
}
