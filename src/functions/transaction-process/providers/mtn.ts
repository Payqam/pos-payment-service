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
import * as process from 'node:process';
import { EnhancedError, ErrorCategory } from '../../../../utils/errorHandler';
import {
  maskMobileNumber,
  registerRedactFilter,
} from '../../../../utils/redactUtil';

// Register redaction filter for masking sensitive data in logs
registerRedactFilter();

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

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.baseUrl =
      process.env.MTN_API_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
    this.logger.info('init()');
    this.logger.debug('MTN API base URL:', this.baseUrl);
    this.logger.debug(
      'MTN target environment:',
      process.env.MTN_TARGET_ENVIRONMENT
    );
    this.logger.debug('PayQAM fee percentage:', PAYQAM_FEE_PERCENTAGE);
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
        type === TransactionType.PAYMENT ||
        type === TransactionType.MERCHANT_REFUND
          ? '/collection/token/'
          : '/disbursement/token/';
      const creds =
        type === TransactionType.PAYMENT ||
        type === TransactionType.MERCHANT_REFUND
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
      throw new Error('Failed to call the webhook');
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
    try {
      this.logger.debug('Starting payment processing', {
        transactionId,
        amount,
        currency,
        transactionType,
        merchantId,
        mobileNo: maskMobileNumber(mobileNo),
        merchantMobileNo: maskMobileNumber(merchantMobileNo),
      });

      const { fee, settlementAmount } = this.calculateFeeAndSettlement(amount);
      this.logger.debug('Fee calculation completed', {
        transactionId,
        originalAmount: amount,
        fee,
        settlementAmount,
      });

      const dateTime = Date.now();
      const axiosInstance = await this.createAxiosInstance(
        TransactionType.PAYMENT,
        transactionId
      );

      this.logger.debug('Created axios instance for payment API', {
        transactionId,
        baseURL: this.baseUrl,
      });

      const requestToPayUrl = '/collection/v1_0/requesttopay';

      this.logger.debug('Preparing payment request', {
        transactionId,
        requestToPayUrl,
        payerPartyIdType: 'MSISDN',
      });

      const response = await axiosInstance.post(requestToPayUrl, {
        amount,
        currency,
        externalId: transactionId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: mobileNo,
        },
        payerMessage,
        payeeNote,
      });

      this.logger.debug('Payment request submitted successfully', {
        transactionId,
        statusCode: response.status,
        headers: {
          'x-reference-id': response.headers['x-reference-id'],
          date: response.headers.date,
        },
      });

      // Create payment record in DynamoDB
      const paymentRecord: CreatePaymentRecord = {
        transactionId,
        status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
        amount,
        currency,
        paymentMethod: 'MTN',
        mobileNo,
        merchantId,
        merchantMobileNo,
        paymentResponse: response.data,
        fee,
        settlementAmount,
        GSI1SK: Math.floor(dateTime / 1000),
        GSI2SK: Math.floor(dateTime / 1000),
        metaData,
      };

      this.logger.debug('Creating payment record in DynamoDB', {
        transactionId,
        status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
        amount,
        currency,
        timestamp: Date.now(),
      });

      await this.dbService.createPaymentRecord(paymentRecord);

      this.logger.debug('Payment record created successfully', {
        transactionId,
      });

      // For sandbox testing, simulate a webhook call
      if (process.env.ENVIRONMENT === 'sandbox') {
        this.logger.debug('Sandbox environment detected, simulating webhook', {
          transactionId,
        });

        const webhookEvent: WebhookEvent = {
          amount: amount.toString(),
          currency,
          financialTransactionId: uuidv4(),
          externalId: transactionId,
          payerMessage,
          payeeNote,
          status: 'SUCCESSFUL',
          reason: undefined,
          payer: {
            partyIdType: 'MSISDN',
            partyId: mobileNo,
          },
        };

        await this.callWebhook(webhookEvent, TransactionType.PAYMENT);

        this.logger.debug('Webhook simulation completed', {
          transactionId,
          webhookStatus: 'SUCCESSFUL',
        });
      }

      this.logger.info('Payment processing completed successfully', {
        transactionId,
        status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
      });

      return {
        transactionId: transactionId,
        status: String(MTNPaymentStatus.PAYMENT_REQUEST_CREATED),
      };
    } catch (error) {
      this.logger.error('Error processing payment', {
        transactionId,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        amount,
        currency,
        merchantId,
      });

      throw new EnhancedError(
        'MTN_PAYMENT_PROCESSING_ERROR',
        ErrorCategory.PROVIDER_ERROR,
        error instanceof Error ? error.message : String(error),
        {
          retryable: true,
          suggestedAction: 'Retry the payment request or contact support.',
          originalError: error,
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

      const response = await axiosInstance.get(endpoint);

      return response.data;
    } catch (error) {
      this.logger.error('Failed to check the transaction status');
      throw new Error('Failed to check the transaction status');
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
      this.logger.debug('Starting transfer initiation', {
        amount,
        currency,
        recipientMobileNo: maskMobileNumber(recipientMobileNo),
        transactionType,
      });

      const transferId = uuidv4();

      this.logger.debug('Generated transfer ID', {
        transferId,
      });

      const axiosInstance = await this.createAxiosInstance(
        TransactionType.TRANSFER,
        transferId
      );

      this.logger.debug('Created axios instance for transfer API', {
        transferId,
        baseURL: this.baseUrl,
      });

      const transferUrl = '/disbursement/v1_0/transfer';

      this.logger.debug('Preparing transfer request', {
        transferId,
        transferUrl,
        payeePartyIdType: 'MSISDN',
      });

      const response = await axiosInstance.post(transferUrl, {
        amount: amount.toString(),
        currency,
        externalId: transferId,
        payee: {
          partyIdType: 'MSISDN',
          partyId: recipientMobileNo,
        },
        payerMessage: 'Payment from PayQAM',
        payeeNote: `Transfer for ${transferId}`,
      });

      this.logger.debug('Transfer request submitted successfully', {
        transferId,
        statusCode: response.status,
        headers: {
          'x-reference-id': response.headers['x-reference-id'],
          date: response.headers.date,
        },
      });

      // For sandbox testing, simulate a webhook call
      if (process.env.ENVIRONMENT === 'sandbox') {
        this.logger.debug(
          'Sandbox environment detected, simulating transfer webhook',
          {
            transferId,
          }
        );

        const webhookEvent: WebhookEvent = {
          amount: amount.toString(),
          currency,
          financialTransactionId: uuidv4(),
          externalId: transferId,
          payerMessage: 'Payment from PayQAM',
          payeeNote: `Transfer for ${transferId}`,
          status: 'SUCCESSFUL',
          reason: undefined,
          payee: {
            partyIdType: 'MSISDN',
            partyId: recipientMobileNo,
          },
        };

        await this.callWebhook(webhookEvent, TransactionType.TRANSFER);

        this.logger.debug('Transfer webhook simulation completed', {
          transferId,
          webhookStatus: 'SUCCESSFUL',
        });
      }

      this.logger.info('Transfer initiated successfully', {
        transferId,
        amount,
        currency,
        recipientMobileNo: maskMobileNumber(recipientMobileNo),
      });

      return transferId;
    } catch (error) {
      this.logger.error('Error initiating transfer', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        amount,
        currency,
        recipientMobileNo: maskMobileNumber(recipientMobileNo),
      });

      throw new EnhancedError(
        'MTN_TRANSFER_INITIATION_ERROR',
        ErrorCategory.PROVIDER_ERROR,
        error instanceof Error ? error.message : String(error),
        {
          retryable: true,
          suggestedAction: 'Retry the transfer request or contact support.',
          originalError: error,
        }
      );
    }
  }
}
