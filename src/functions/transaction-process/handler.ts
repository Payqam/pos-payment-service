import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import { API } from '../../../configurations/api';
import { PaymentService } from './paymentService';
import { ErrorHandler, ErrorCategory } from '../../../utils/errorHandler';
import { DynamoDBService } from '../../services/dynamodbService';
import {
  registerRedactFilter,
  maskMobileNumber,
} from '../../../utils/redactUtil';

// Register redaction filter for masking sensitive data in logs
registerRedactFilter();

const logger: Logger = LoggerService.named('transaction-process-handler');

const sensitiveFields = [
  'id',
  'destinationId',
  'cardName',
  'subscriptionKey',
  'apiKey',
  'apiUser',
];
registerRedactFilter(sensitiveFields);

export class TransactionProcessService {
  private readonly logger: Logger;

  private readonly paymentService: PaymentService;

  private readonly dbService: DynamoDBService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.paymentService = new PaymentService(this.logger);
    this.dbService = new DynamoDBService();
    this.logger.info('init()');
  }

  public async processTransaction(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    this.logger.info('Received transaction process request', {
      path: event.path,
      httpMethod: event.httpMethod,
      resourcePath: event.resource,
      hasBody: !!event.body,
    });

    try {
      switch (event.httpMethod) {
        case 'POST':
          this.logger.debug('Processing POST request');
          return await this.handlePost(event);
        case 'GET':
          this.logger.debug('Processing GET request');
          return await this.handleGet(event);
        default:
          this.logger.warn('Method not allowed', {
            method: event.httpMethod,
          });
          return ErrorHandler.createErrorResponse(
            'METHOD_NOT_ALLOWED',
            ErrorCategory.VALIDATION_ERROR,
            `Method ${event.httpMethod} not allowed`
          );
      }
    } catch (error: unknown) {
      this.logger.error('Failed to process transaction request', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
      });
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
      this.logger.warn('Missing request body');
      return ErrorHandler.createErrorResponse(
        'MISSING_BODY',
        ErrorCategory.VALIDATION_ERROR,
        'Request body is missing'
      );
    }

    try {
      const body = JSON.parse(event.body);

      // Log with sensitive data masked
      this.logger.debug('Processing payment request', {
        transactionId: body.transactionId,
        amount: body.amount,
        paymentMethod: body.paymentMethod,
        currency: body.currency,
        transactionType: body.transactionType,
        merchantId: body.merchantId,
        customerPhone: body.customerPhone
          ? maskMobileNumber(body.customerPhone)
          : undefined,
        merchantMobileNo: body.merchantMobileNo
          ? maskMobileNumber(body.merchantMobileNo)
          : undefined,
        hasCardData: !!body.cardData,
        hasMetaData: !!body.metaData,
      });

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
        this.logger.warn('Missing required fields', {
          paymentMethod,
        });
        return ErrorHandler.createErrorResponse(
          'MISSING_FIELDS',
          ErrorCategory.VALIDATION_ERROR,
          'Missing required fields: amount or paymentMethod'
        );
      }

      this.logger.debug('Calling payment service to process payment', {
        transactionId,
        paymentMethod,
        transactionType,
      });

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

      this.logger.info('Payment processed successfully', {
        transactionId,
        paymentMethod,
        transactionType,
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
    } catch (error) {
      this.logger.error('Error processing payment request', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        body: event.body,
      });
      throw error;
    }
  }

  private async handleGet(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    const transactionId = event.queryStringParameters?.transactionId;

    this.logger.debug('Retrieving transaction details', {
      transactionId,
    });

    if (!transactionId) {
      this.logger.warn('Missing transaction ID in request');
      return ErrorHandler.createErrorResponse(
        'MISSING_TRANSACTION_ID',
        ErrorCategory.VALIDATION_ERROR,
        'Transaction ID is required'
      );
    }

    try {
      this.logger.debug('Querying DynamoDB for transaction', {
        transactionId,
      });

      const transactionDetails = await this.dbService.getItem<{
        transactionId: string;
      }>({
        transactionId,
      });

      if (!transactionDetails.Item) {
        this.logger.warn('Transaction not found', {
          transactionId,
        });
        return ErrorHandler.createErrorResponse(
          'TRANSACTION_NOT_FOUND',
          ErrorCategory.SYSTEM_ERROR,
          'Transaction not found'
        );
      }

      this.logger.info('Transaction retrieved successfully', {
        transactionId,
        status: transactionDetails.Item?.status,
      });

      return {
        statusCode: 200,
        headers: this.getDefaultResponseHeaders(),
        body: JSON.stringify({
          message: 'Transaction retrieved successfully',
          transaction: transactionDetails,
        }),
      };
    } catch (error) {
      this.logger.error('Error retrieving transaction', {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
        transactionId,
      });
      throw error;
    }
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.info('Transaction process handler invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
    resourcePath: event.resource,
  });

  const service = new TransactionProcessService();
  return service.processTransaction(event);
};
