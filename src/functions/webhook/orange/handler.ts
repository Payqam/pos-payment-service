import { APIGatewayProxyHandler } from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';

const logger: Logger = LoggerService.named('orange-webhook');

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Define the fields you want to mask
    logger.info('Received event:', JSON.stringify(event, null, 2));
    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Event logged successfully' }),
    };
  } catch (error) {
    logger.error('Failed to log event', { error });
    return {
      statusCode: 500,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ error: 'Failed to log event' }),
    };
  }
};
