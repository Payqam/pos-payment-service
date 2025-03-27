import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../configurations/api';
import { PaymentService } from './paymentService';
import { Logger, LoggerService } from '@mu-ts/logger';
import { registerRedactFilter } from '../../../utils/redactUtil';
import {
  ErrorHandler,
  ErrorCategory,
  EnhancedError,
} from '../../../utils/errorHandler';
import { DynamoDBService } from '../../services/dynamodbService';
// Import AWS SDK directly instead of relying on failure-lambda's import
import * as AWS from 'aws-sdk';

const sensitiveFields = [
  'id',
  'destinationId',
  'cardName',
  'subscriptionKey',
  'apiKey',
  'apiUser',
];
registerRedactFilter(sensitiveFields);

// Custom failure injection configuration type
interface FailureConfig {
  isEnabled: boolean;
  failureMode:
    | 'latency'
    | 'exception'
    | 'denylist'
    | 'diskspace'
    | 'statuscode';
  rate: number;
  minLatency?: number;
  maxLatency?: number;
  exceptionMsg?: string;
  statusCode?: number;
  diskSpace?: number;
  denylist?: string[];
}

// Custom implementation of failure-lambda functionality
const customFailureLambda = <T, U>(handler: (event: T) => Promise<U>) => {
  return async (event: T): Promise<U> => {
    const logger = LoggerService.named('FailureInjection');

    try {
      // Get failure configuration from SSM Parameter Store
      const paramName =
        process.env.FAILURE_INJECTION_PARAM || 'failureLambdaConfig';
      const ssm = new AWS.SSM({ region: process.env.AWS_REGION });
      const paramResult = await ssm.getParameter({ Name: paramName }).promise();

      if (!paramResult.Parameter || !paramResult.Parameter.Value) {
        logger.info('No failure configuration found, proceeding normally');
        return handler(event);
      }

      const config: FailureConfig = JSON.parse(paramResult.Parameter.Value);

      // If failure injection is disabled, proceed normally
      if (!config.isEnabled) {
        logger.info('Failure injection is disabled, proceeding normally');
        return handler(event);
      }

      // Determine if this invocation should experience failure based on rate
      const shouldFail = Math.random() < config.rate;
      if (!shouldFail) {
        logger.info('Randomly skipping failure injection based on rate');
        return handler(event);
      }

      logger.info(`Injecting failure mode: ${config.failureMode}`);

      // Implement different failure modes
      switch (config.failureMode) {
        case 'latency':
          if (
            config.minLatency !== undefined &&
            config.maxLatency !== undefined
          ) {
            const latency = Math.floor(
              Math.random() * (config.maxLatency - config.minLatency) +
                config.minLatency
            );
            logger.info(`Injecting latency of ${latency}ms`);
            await new Promise((resolve) => setTimeout(resolve, latency));
          }
          break;

        case 'exception':
          logger.info(`Throwing injected exception: ${config.exceptionMsg}`);
          throw new EnhancedError(
            config.exceptionMsg || 'Injected failure for testing',
            ErrorCategory.SYSTEM_ERROR,
            {
              isRetryable: true,
              suggestedAction: 'Retry the request',
              transactionId: (event as any).body
                ? JSON.parse((event as any).body).transactionId
                : undefined,
            }
          );

        case 'statuscode':
          if (config.statusCode !== undefined) {
            logger.info(`Returning status code: ${config.statusCode}`);
            return {
              statusCode: config.statusCode,
              headers: API.DEFAULT_HEADERS,
              body: JSON.stringify({
                message: 'Injected failure status code for testing',
                error: 'INJECTED_FAILURE',
              }),
            } as unknown as U;
          }
          break;

        case 'diskspace':
          if (config.diskSpace !== undefined) {
            logger.info(`Filling disk space with ${config.diskSpace}MB`);
            // This is a simplified version - in a real implementation,
            // you would create a file of the specified size
            logger.warn('Disk space filling not implemented in this version');
          }
          break;

        case 'denylist':
          // This would normally block connections to specified endpoints
          // For simplicity, we're just logging this case
          logger.info(
            `Denylist mode enabled with patterns: ${config.denylist?.join(', ')}`
          );
          logger.warn(
            'Denylist functionality not fully implemented in this version'
          );
          break;
      }

      // If we get here, either the failure mode didn't result in termination
      // or we're simulating latency only, so proceed with the handler
      return handler(event);
    } catch (error) {
      // If the error was generated by our failure injection, rethrow it
      if (
        error instanceof EnhancedError &&
        error.metadata?.suggestedAction === 'Retry the request'
      ) {
        throw error;
      }

      // For other errors in the failure injection itself, log and proceed with handler
      logger.error(
        'Error in failure injection, proceeding with normal handler',
        error
      );
      return handler(event);
    }
  };
};

export class TransactionProcessService {
  private readonly logger: Logger;

  private readonly paymentService: PaymentService;

  private readonly dbService: DynamoDBService;

  constructor() {
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.paymentService = new PaymentService(this.logger);
    this.dbService = new DynamoDBService();
    this.logger.info('init()');
  }

  public async processTransaction(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    this.logger.info('Received event:', event);

    try {
      switch (event.httpMethod) {
        case 'POST':
          return await this.handlePost(event);
        case 'GET':
          return await this.handleGet(event);
        default:
          return ErrorHandler.createErrorResponse(
            'METHOD_NOT_ALLOWED',
            ErrorCategory.VALIDATION_ERROR,
            `Method ${event.httpMethod} not allowed`
          );
      }
    } catch (error: unknown) {
      return ErrorHandler.handleException(error, 'Failed to process request');
    }
  }

  private getDefaultResponseHeaders() {
    return API.DEFAULT_HEADERS;
  }

  private async handlePost(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    if (!event.body) {
      return ErrorHandler.createErrorResponse(
        'MISSING_BODY',
        ErrorCategory.VALIDATION_ERROR,
        'Request body is missing'
      );
    }

    const body = JSON.parse(event.body);
    this.logger.info('Parsed body:', body);

    const {
      transactionId,
      amount,
      paymentMethod,
      currency,
      cardData,
      customerPhone,
      metaData,
      merchantMobileNo,
      transactionType,
      merchantId,
      payerMessage,
      payeeNote,
    } = body;

    if (!paymentMethod) {
      return ErrorHandler.createErrorResponse(
        'MISSING_FIELDS',
        ErrorCategory.VALIDATION_ERROR,
        'Missing required fields: amount or paymentMethod'
      );
    }

    const transactionResult = await this.paymentService.processPayment({
      transactionId,
      amount,
      paymentMethod,
      currency,
      cardData,
      customerPhone,
      metaData,
      merchantId,
      transactionType,
      merchantMobileNo,
      payerMessage,
      payeeNote,
    });

    return {
      statusCode: 200,
      headers: this.getDefaultResponseHeaders(),
      body: JSON.stringify({
        message:
          transactionType === 'REFUND'
            ? 'Refund processed successfully'
            : 'Payment processed successfully',
        transactionDetails: transactionResult,
      }),
    };
  }

  private async handleGet(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    const transactionId = event.queryStringParameters?.transactionId;
    this.logger.info('transactionId:', transactionId);
    if (!transactionId) {
      return ErrorHandler.createErrorResponse(
        'MISSING_TRANSACTION_ID',
        ErrorCategory.VALIDATION_ERROR,
        'Transaction ID is required'
      );
    }

    const transactionDetails = await this.dbService.getItem<{
      transactionId: string;
    }>({
      transactionId,
    });
    return {
      statusCode: 200,
      headers: this.getDefaultResponseHeaders(),
      body: JSON.stringify({
        message: 'Transaction retrieved successfully',
        transaction: transactionDetails,
      }),
    };
  }
}

/**
 * Lambda handler for processing payment transactions.
 * This handler is wrapped with a custom failure injection implementation for fault testing.
 *
 * Failure injection can be controlled via SSM Parameter Store using the parameter
 * specified in the FAILURE_INJECTION_PARAM environment variable.
 *
 * Available failure modes:
 * - latency: Adds artificial delay to the function execution
 * - exception: Throws an exception with a configurable message
 * - denylist: Blocks connections to specified endpoints (limited implementation)
 * - diskspace: Fills /tmp with a file of specified size (limited implementation)
 * - statuscode: Returns a specific HTTP status code
 *
 * Configuration example in SSM Parameter Store:
 * {
 *   "isEnabled": false,
 *   "failureMode": "latency",
 *   "rate": 1,
 *   "minLatency": 100,
 *   "maxLatency": 400,
 *   "exceptionMsg": "Injected failure exception!",
 *   "statusCode": 500,
 *   "diskSpace": 100,
 *   "denylist": ["dynamodb.*.amazonaws.com"]
 * }
 *
 * @param event - API Gateway proxy event
 * @returns API Gateway proxy result
 */
export const handler = customFailureLambda(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const service = new TransactionProcessService();
    return service.processTransaction(event);
  }
);
