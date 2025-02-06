import { APIGatewayProxyHandler } from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { MtnPaymentService } from '../../transaction-process/providers';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { TransactionType } from '../../transaction-process/providers';

const logger: Logger = LoggerService.named('mtn-webhook-handler');
const mtnService = new MtnPaymentService();
const dbService = new DynamoDBService();
const snsClient = new SNSClient({ region: process.env.AWS_REGION });

/**
 * Structure of the webhook event received from MTN.
 * MTN sends different event types for payments and transfers,
 * but they follow the same basic structure.
 */
interface WebhookEvent {
  type: string;
  data: {
    transactionId: string;
    status: string;
    reason?: string;
    amount: string;
    currency: string;
    payerMessage?: string;
    payeeNote?: string;
  };
}

/**
 * Structure for the DynamoDB record key.
 * Used to identify the transaction record to update.
 */
interface PaymentRecordKey {
  transactionId: string;
}

/**
 * Structure for updating the payment record in DynamoDB.
 * Includes the new status and payment provider's response.
 */
interface PaymentRecordUpdate {
  status: string;
  paymentProviderResponse?: {
    status: string;
    reason?: string;
  };
}

/**
 * Lambda function handler for MTN Mobile Money webhooks.
 * Processes incoming webhook events for both payments and transfers.
 *
 * Flow:
 * 1. Validates the webhook payload
 * 2. Verifies the transaction status with MTN API
 * 3. Updates the transaction record in DynamoDB
 * 4. Publishes a notification to SNS
 *
 * Required environment variables:
 * - TRANSACTIONS_TABLE: DynamoDB table name
 * - TRANSACTION_STATUS_TOPIC_ARN: SNS topic ARN
 * - MTN_API_SECRET: Path to MTN API secret in Secrets Manager
 *
 * @param event - API Gateway proxy event
 * @returns API Gateway proxy response
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    logger.info('Received MTN webhook event', { event });

    if (!event.body) {
      return {
        statusCode: 400,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ message: 'No body provided' }),
      };
    }

    const webhookEvent = JSON.parse(event.body) as WebhookEvent;
    const { transactionId, status, reason } = webhookEvent.data;

    // Determine transaction type from webhook event type
    const transactionType = webhookEvent.type.includes('transfer')
      ? TransactionType.TRANSFER
      : TransactionType.PAYMENT;

    // Verify transaction status with MTN API to prevent webhook spoofing
    const verifiedStatus = await mtnService.checkTransactionStatus(
      transactionId,
      transactionType
    );

    if (verifiedStatus !== status) {
      logger.error('Status mismatch', {
        webhookStatus: status,
        verifiedStatus,
      });
      return {
        statusCode: 400,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ message: 'Status verification failed' }),
      };
    }

    // Update transaction record in DynamoDB with new status
    const key: PaymentRecordKey = { transactionId };
    const updateFields: PaymentRecordUpdate = {
      status,
      paymentProviderResponse: {
        status,
        reason,
      },
    };

    await dbService.updatePaymentRecord(key, updateFields);

    // Publish status update to SNS for downstream processing
    const snsMessage = {
      transactionId,
      status,
      type: webhookEvent.type,
      amount: webhookEvent.data.amount,
      currency: webhookEvent.data.currency,
      reason: webhookEvent.data.reason,
      timestamp: new Date().toISOString(),
    };

    await snsClient.send(
      new PublishCommand({
        TopicArn: process.env.TRANSACTION_STATUS_TOPIC_ARN,
        Message: JSON.stringify(snsMessage),
        MessageAttributes: {
          transactionType: {
            DataType: 'String',
            StringValue: transactionType,
          },
        },
      })
    );

    logger.info('Successfully processed webhook', {
      transactionId,
      status,
      type: webhookEvent.type,
    });

    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    };
  } catch (error) {
    logger.error('Error processing webhook', error);
    return {
      statusCode: 500,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
