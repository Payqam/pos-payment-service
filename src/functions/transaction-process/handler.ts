import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../configurations/api';
import { PaymentService } from './paymentService';
import { Logger, LoggerService } from '@mu-ts/logger';
import { registerRedactFilter } from '../../../utils/redactUtil';
import { ErrorHandler, ErrorCategory } from '../../../utils/errorHandler';
import { KmsService } from '../../services/kmsService';
import { DynamoDBService } from '../../services/dynamodbService';

// Configure sensitive field redaction in logs
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

  private readonly kmsService: KmsService;

  private readonly dbService: DynamoDBService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.paymentService = new PaymentService(this.logger);
    this.kmsService = new KmsService();
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
      amount,
      paymentMethod,
      cardData,
      customerPhone,
      metaData,
      merchantMobileNo,
      transactionType,
      merchantId,
    } = body;

    if (!paymentMethod) {
      return ErrorHandler.createErrorResponse(
        'MISSING_FIELDS',
        ErrorCategory.VALIDATION_ERROR,
        'Missing required fields: amount or paymentMethod'
      );
    }

    if (
      (paymentMethod === 'MTN' || paymentMethod === 'ORANGE') &&
      (!merchantId || !merchantMobileNo)
    ) {
      return ErrorHandler.createErrorResponse(
        'MISSING_MERCHANT_INFO',
        ErrorCategory.VALIDATION_ERROR,
        `Missing required fields: merchantId or merchantMobileNo for ${paymentMethod} payment`
      );
    }

    const transactionResult = await this.paymentService.processPayment({
      amount,
      paymentMethod,
      cardData,
      customerPhone,
      metaData,
      merchantId,
      transactionType,
      merchantMobileNo,
    });

    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({
        message: 'Payment processed successfully',
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
      headers: API.DEFAULT_HEADERS,
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
