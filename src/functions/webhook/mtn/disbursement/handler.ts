import { APIGatewayProxyHandler } from 'aws-lambda';
import { API } from '../../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBService } from '../../../../services/dynamodbService';
import { SNSService } from '../../../../services/snsService';

const logger: Logger = LoggerService.named('mtn-disbursement-webhook-handler');
const dbService = new DynamoDBService();
const snsService = SNSService.getInstance();

/**
 * Structure of the webhook event received from MTN.
 */
interface WebhookEvent {
  financialTransactionId: string;
  externalId: string;
  amount: string;
  currency: string;
  payer: {
    partyIdType: string;
    partyId: string;
  };
  payeeNote?: string;
  status: string;
}

/**
 * Handler for MTN Mobile Money disbursement webhook events
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    logger.info('Received MTN webhook event', { event });

    if (!event.body) {
      logger.error('No body in webhook event');
      return {
        statusCode: 400,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ message: 'No body provided' }),
      };
    }

    const webhookEvent = JSON.parse(event.body) as WebhookEvent;
    const { financialTransactionId, externalId, amount, currency, status } =
      webhookEvent;

    logger.info('Processing webhook event', {
      financialTransactionId,
      externalId,
      status,
      amount,
      currency,
    });

    // Get transaction by settlementId using GSI
    const result = await dbService.getItem(
      {
        settlementId: externalId,
      },
      'SettlementIndex'
    );

    if (!result?.Item) {
      logger.error('Transaction not found for settlement', { externalId });
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'Transaction not found' }),
      };
    }

    // Update settlement status
    await dbService.updatePaymentRecordByTransactionId(
      result.Item.transactionId,
      {
        settlementStatus: status === 'SUCCESSFUL' ? 'SUCCESS' : 'FAILED',
        settlementResponse: webhookEvent,
      }
    );

    // Publish settlement status update using SNS service
    await snsService.publish(process.env.TRANSACTION_STATUS_TOPIC_ARN!, {
      transactionId: result.Item.transactionId,
      settlementId: externalId,
      status: status,
      type: 'SETTLEMENT',
      amount: amount,
      currency: currency,
    });

    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    };
  } catch (error) {
    logger.error('Error processing webhook', { error });
    return {
      statusCode: 500,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
