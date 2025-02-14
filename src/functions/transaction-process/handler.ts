import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../configurations/api';
import { PaymentService } from './paymentService';
import { Logger, LoggerService } from '@mu-ts/logger';
import { registerRedactFilter } from '../../../utils/redactUtil';
import { ErrorHandler, ErrorCategory } from '../../../utils/errorHandler';
import { KmsService } from '../../services/kmsService';

// Configure sensitive field redaction in logs
const sensitiveFields = ['id', 'destinationId', 'cardName', 'subscriptionKey', 'apiKey', 'apiUser'];
registerRedactFilter(sensitiveFields);

export class TransactionProcessService {
  private readonly logger: Logger;

  private readonly paymentService: PaymentService;

  private readonly kmsService: KmsService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.paymentService = new PaymentService(this.logger);
    this.kmsService = new KmsService();
    this.logger.info('init()');
  }

  public async processTransaction(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    this.logger.info('Received event:', event);

    try {
      if (!event.body) {
        return ErrorHandler.createErrorResponse(
          'MISSING_BODY',
          ErrorCategory.VALIDATION_ERROR,
          'Request body is missing'
        );
      }

      const body = JSON.parse(event.body);
      this.logger.info('Parsed body:', body);

      const { amount, paymentMethod, cardData, customerPhone, metaData } = body;

      if (!amount || !paymentMethod) {
        return ErrorHandler.createErrorResponse(
          'MISSING_FIELDS',
          ErrorCategory.VALIDATION_ERROR,
          'Missing required fields: amount or paymentMethod'
        );
      }

      // TODO: We need to decide what are the data fields that need to be decrypted.
      // let decryptedPhone = customerPhone;
      // if (customerPhone) {
      //   decryptedPhone = await this.kmsService.decryptData(customerPhone);
      //   this.logger.info('Decrypted customer phone:', decryptedPhone);
      // }

      const transactionResult = await this.paymentService.processPayment({
        amount,
        paymentMethod,
        cardData,
        // customerPhone: decryptedPhone,
        customerPhone,
        metaData,
      });

      return {
        statusCode: 200,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({
          message: 'Payment processed successfully',
          result: transactionResult,
        }),
      };
    } catch (error: unknown) {
      return ErrorHandler.handleException(error, 'Failed to process payment');
    }
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const service = new TransactionProcessService();
  return service.processTransaction(event);
};
