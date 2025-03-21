import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../configurations/api';
import { PaymentService } from './paymentService';
import { Logger, LoggerService } from '@mu-ts/logger';
import { registerRedactFilter } from '../../../utils/redactUtil';
import { ErrorHandler, ErrorCategory } from '../../../utils/errorHandler';
import { DynamoDBService } from '../../services/dynamodbService';

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
        message: transactionType === 'REFUND' 
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

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const service = new TransactionProcessService();
  return service.processTransaction(event);
};
