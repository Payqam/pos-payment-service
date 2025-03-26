import { SNSEvent, SNSHandler } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SecretsManagerService } from '../../services/secretsManagerService';
import axios from 'axios';
import {
  registerRedactFilter,
  maskSensitiveValue,
  maskMobileNumber,
} from '../../../utils/redactUtil';
import { SalesforceCredentials, SNSMessage } from '../../model';
import { SalesforcePaymentRecord } from '../../model/salesforce';
import { EnhancedError, ErrorCategory } from '../../../utils/errorHandler';

const sensitiveFields = [
  'clientId',
  'clientSecret',
  'username',
  'password',
  'accessToken',
  'refreshToken',
  'merchantPhone',
  'customerPhone',
  'apiKey',
  'apiSecret',
  'authToken',
  'signature',
  'securityToken',
];

registerRedactFilter(sensitiveFields);

export class SalesforceSyncService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly startTime: number;

  constructor() {
    this.startTime = Date.now();
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.logger.debug('SalesforceSyncService initialized', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
    });
  }

  private async getSalesforceCredentials(): Promise<SalesforceCredentials> {
    const secretName = process.env.SALESFORCE_SECRET as string;
    const operationContext = {
      secretName: secretName ? `${secretName.substring(0, 5)}...` : 'undefined',
      startTime: Date.now(),
    };

    this.logger.debug('Retrieving Salesforce credentials', operationContext);

    try {
      const secretResponse =
        await this.secretsManagerService.getSecret(secretName);

      if (!secretResponse) {
        this.logger.error('Salesforce credentials not found', {
          ...operationContext,
          durationMs: Date.now() - operationContext.startTime,
        });
        throw new EnhancedError(
          'SALESFORCE_CREDENTIALS_NOT_FOUND',
          ErrorCategory.SYSTEM_ERROR,
          'Salesforce credentials not found in Secrets Manager',
          { retryable: false }
        );
      }

      this.logger.debug('Successfully retrieved Salesforce credentials', {
        ...operationContext,
        durationMs: Date.now() - operationContext.startTime,
        hasClientId: !!secretResponse.clientId,
        hasUsername: !!secretResponse.username,
      });

      return secretResponse as unknown as SalesforceCredentials;
    } catch (error) {
      this.logger.error('Error retrieving Salesforce credentials', {
        ...operationContext,
        durationMs: Date.now() - operationContext.startTime,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      });

      throw new EnhancedError(
        'SALESFORCE_CREDENTIALS_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to retrieve Salesforce credentials',
        {
          retryable: true,
          originalError: error,
        }
      );
    }
  }

  private async getAccessToken(
    credentials: SalesforceCredentials
  ): Promise<string> {
    const operationContext = {
      startTime: Date.now(),
      host: credentials.host
        ? `${credentials.host.substring(0, 12)}...`
        : 'undefined',
    };

    this.logger.debug('Requesting Salesforce auth token', operationContext);

    try {
      const authParams = {
        grant_type: 'password',
        client_id: maskSensitiveValue(credentials.clientId, '*', 4),
        client_secret: maskSensitiveValue(credentials.clientSecret, '*', 0),
        username: maskSensitiveValue(credentials.username, '*', 3),
        password: '********',
      };

      this.logger.debug('Auth request parameters prepared', {
        ...operationContext,
        authParams,
      });

      const authResponse = await axios.post(
        `https://login.salesforce.com/services/oauth2/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          username: credentials.username,
          password: credentials.password,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      this.logger.debug('Successfully retrieved Salesforce auth token', {
        ...operationContext,
        durationMs: Date.now() - operationContext.startTime,
        tokenType: authResponse.data.token_type,
        instanceUrl: authResponse.data.instance_url,
        responseStatus: authResponse.status,
      });

      return authResponse.data.access_token;
    } catch (error) {
      let statusCode, responseData;
      if (
        error &&
        typeof error === 'object' &&
        'isAxiosError' in error &&
        error.isAxiosError
      ) {
        const axiosError = error as any;
        statusCode = axiosError.response?.status;
        responseData = axiosError.response?.data;
      }

      this.logger.error('Error fetching Salesforce auth token', {
        ...operationContext,
        durationMs: Date.now() - operationContext.startTime,
        error: error instanceof Error ? error.message : String(error),
        statusCode,
        responseData,
        stackTrace: error instanceof Error ? error.stack : undefined,
      });

      throw new EnhancedError(
        'SALESFORCE_AUTH_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to fetch Salesforce auth token',
        {
          retryable: true,
          originalError: error,
          httpStatus: statusCode,
        }
      );
    }
  }

  private async handlePaymentCreated(
    message: SNSMessage,
    credentials: SalesforceCredentials
  ) {
    const transactionId = message.transactionId || 'unknown';
    const operationContext = {
      transactionId,
      startTime: Date.now(),
      paymentMethod: message.paymentMethod,
      status: message.status,
    };

    this.logger.debug(
      'Processing payment record for Salesforce sync',
      operationContext
    );

    try {
      const accessToken = await this.getAccessToken(credentials);
      const urlHost = credentials.host;

      const transactionError =
        message.TransactionError &&
        (message.TransactionError.ErrorMessage ||
          message.TransactionError.ErrorCode ||
          message.TransactionError.ErrorType ||
          message.TransactionError.ErrorSource)
          ? {
              transactionError: {
                errorCode: message.TransactionError.ErrorCode,
                errorMessage: message.TransactionError.ErrorMessage,
                errorType: message.TransactionError.ErrorType,
                errorSource: message.TransactionError.ErrorSource,
              },
            }
          : {};

      const maskedMerchantPhone = message.merchantMobileNo
        ? maskMobileNumber(message.merchantMobileNo)
        : undefined;

      const maskedCustomerPhone = message.customerPhone
        ? maskMobileNumber(message.customerPhone)
        : undefined;

      const recordPayload: SalesforcePaymentRecord = {
        ownerId: credentials.ownerId ?? '',
        serviceType: message.paymentMethod ?? '',
        transactionId: message.transactionId ?? '',
        status: message.status ?? '',
        amount: message.settlementAmount?.toString() ?? '',
        merchantId: message.merchantId ?? '',
        merchantPhone: message.merchantMobileNo ?? '',
        transactionType: message.transactionType ?? '',
        metaData: message.metaData ? JSON.stringify(message.metaData) : '',
        fee: message.fee?.toString() ?? '',
        deviceId: message.metaData?.deviceId ?? '',
        transactionDateTime: message.createdOn ?? '',
        customerPhone: message.customerPhone ?? '',
        currency: message.currency ?? '',
        exchangeRate: message.exchangeRate ?? '',
        processingFee: message.processingFee ?? '',
        netAmount: message.amount?.toString() ?? '',
        externalTransactionId: message.externalTransactionId ?? '',
        originalTransactionId: message.originalTransactionId ?? '',
        ...transactionError,
      };

      const maskedPayload = {
        ...recordPayload,
        merchantPhone: maskedMerchantPhone,
        customerPhone: maskedCustomerPhone,
        transactionId: maskSensitiveValue(recordPayload.transactionId, '*', 4),
        externalTransactionId: recordPayload.externalTransactionId
          ? maskSensitiveValue(recordPayload.externalTransactionId, '*', 4)
          : '',
      };

      this.logger.debug('Creating Salesforce Payment record', {
        ...operationContext,
        recordPayload: maskedPayload,
        hasTransactionError: Object.keys(transactionError).length > 0,
      });

      const apiStartTime = Date.now();
      const createRecordResponse = await axios.post(
        `${urlHost}/services/apexrest/PayQam/Streaming`,
        recordPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.debug('Successfully created Salesforce record', {
        ...operationContext,
        recordId: createRecordResponse.data.id,
        responseStatus: createRecordResponse.status,
        apiDurationMs: Date.now() - apiStartTime,
        totalDurationMs: Date.now() - operationContext.startTime,
      });
    } catch (error) {
      let statusCode, responseData;
      if (
        error &&
        typeof error === 'object' &&
        'isAxiosError' in error &&
        error.isAxiosError
      ) {
        const axiosError = error as any;
        statusCode = axiosError.response?.status;
        responseData = axiosError.response?.data;
      }

      this.logger.error('Error creating Salesforce record', {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        statusCode,
        responseData,
        durationMs: Date.now() - operationContext.startTime,
        stackTrace: error instanceof Error ? error.stack : undefined,
      });

      throw new EnhancedError(
        'SALESFORCE_RECORD_CREATE_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to create Salesforce record for transaction ${transactionId}`,
        {
          retryable: true,
          originalError: error,
          httpStatus: statusCode,
          transactionId,
        }
      );
    }
  }

  public async processEvent(event: SNSEvent): Promise<void> {
    const operationContext = {
      recordCount: event.Records.length,
      startTime: this.startTime,
      processingStartTime: Date.now(),
    };

    this.logger.debug('Processing Salesforce sync event', operationContext);

    try {
      const credentials = await this.getSalesforceCredentials();
      let successCount = 0;
      let failureCount = 0;

      for (const record of event.Records) {
        const messageContext = {
          messageId: record.Sns.MessageId,
          topicArn: maskSensitiveValue(record.Sns.TopicArn, '*', 8),
          timestamp: record.Sns.Timestamp,
          startTime: Date.now(),
        };

        try {
          this.logger.debug('Processing SNS message', messageContext);

          const message: SNSMessage = JSON.parse(record.Sns.Message);
          const transactionId = message.transactionId || 'unknown';

          this.logger.debug('Parsed SNS message', {
            ...messageContext,
            transactionId,
            status: message.status,
            paymentMethod: message.paymentMethod,
            hasError: !!message.TransactionError,
          });

          await this.handlePaymentCreated(message, credentials);

          this.logger.debug('Successfully processed message', {
            ...messageContext,
            transactionId,
            durationMs: Date.now() - messageContext.startTime,
          });

          successCount++;
        } catch (messageError) {
          failureCount++;
          this.logger.error('Error processing individual message', {
            ...messageContext,
            error:
              messageError instanceof Error
                ? messageError.message
                : String(messageError),
            stackTrace:
              messageError instanceof Error ? messageError.stack : undefined,
            durationMs: Date.now() - messageContext.startTime,
          });
        }
      }

      this.logger.debug('Completed Salesforce sync batch processing', {
        ...operationContext,
        successCount,
        failureCount,
        totalDurationMs: Date.now() - this.startTime,
        batchDurationMs: Date.now() - operationContext.processingStartTime,
      });
    } catch (error) {
      this.logger.error('Error processing Salesforce sync event', {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - this.startTime,
      });

      throw new EnhancedError(
        'SALESFORCE_SYNC_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to process Salesforce sync event',
        {
          retryable: true,
          originalError: error,
        }
      );
    }
  }
}

export const handler: SNSHandler = async (event: SNSEvent) => {
  const service = new SalesforceSyncService();
  const logger = LoggerService.named('SalesforceSync');
  const startTime = Date.now();

  try {
    logger.debug('Starting Salesforce sync handler', {
      recordCount: event.Records.length,
      timestamp: new Date().toISOString(),
    });

    await service.processEvent(event);

    logger.debug('Salesforce sync handler completed successfully', {
      recordCount: event.Records.length,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Unhandled exception in Salesforce sync handler', {
      error: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
      recordCount: event.Records.length,
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
};
