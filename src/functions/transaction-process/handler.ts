import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../../../configurations/api';
import { PaymentService } from './paymentService';
import { Logger, LoggerService } from '@mu-ts/logger';
import { registerRedactFilter } from '../../../utils/redactUtil';

const sensitiveFields = ['id', 'destinationId', 'cardName'];
registerRedactFilter(sensitiveFields);

export class TransactionProcessService {
  private readonly logger: Logger;

  private readonly paymentService: PaymentService;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.paymentService = new PaymentService(this.logger);
    this.logger.info('init()');
  }

  public async processTransaction(
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> {
    this.logger.info('Received event:', event);

    try {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: API.DEFAULT_HEADERS,
          body: JSON.stringify({ error: 'Request body is missing' }),
        };
      }

      const body = JSON.parse(event.body);
      this.logger.info('Parsed body:', body);

      const { amount, paymentMethod, cardData, customerPhone } = body;

      if (!amount || !paymentMethod) {
        return {
          statusCode: 400,
          headers: API.DEFAULT_HEADERS,
          body: JSON.stringify({
            error: 'Missing required fields: amount or paymentMethod',
          }),
        };
      }

      const transactionResult = await this.paymentService.processPayment({
        amount,
        paymentMethod,
        cardData,
        customerPhone,
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Error processing transaction:', error);

      return {
        statusCode: 500,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({
          error: 'Failed to process payment',
          details: errorMessage,
        }),
      };
    }
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const service = new TransactionProcessService();
  return service.processTransaction(event);
};
