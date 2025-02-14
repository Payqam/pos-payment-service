import { SNSEvent, SNSHandler } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';
import { registerRedactFilter } from '../../../utils/redactUtil';

const logger: Logger = LoggerService.named('salesforce-sync');
const secretsManager = new SecretsManagerClient({});

// Configure sensitive field redaction in logs
const sensitiveFields = ['clientId', 'clientSecret', 'username', 'password'];
registerRedactFilter(sensitiveFields);

interface SalesforceCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  instanceUrl: string;
}

async function handlePaymentStatusUpdate(
  message: never,
  credentials: SalesforceCredentials
) {
  // TODO: Implement Salesforce API call to update payment status
  logger.info('Handling payment status update', { message, credentials });
}

async function handlePaymentCreated(
  message: never,
  credentials: SalesforceCredentials
) {
  // TODO: Implement Salesforce API call to create payment record
  logger.info('Handling payment created', { message, credentials });
}

export const handler: SNSHandler = async (event: SNSEvent) => {
  try {
    logger.info('Processing Salesforce sync event', { event });

    // Get Salesforce credentials from Secrets Manager
    const secretArn = process.env.SALESFORCE_SECRET_ARN;
    if (!secretArn) {
      throw new Error('SALESFORCE_SECRET_ARN environment variable not set');
    }

    const command = new GetSecretValueCommand({
      SecretId: secretArn,
    });
    const secretResponse = await secretsManager.send(command);

    if (!secretResponse.SecretString) {
      throw new Error('No secret value found');
    }

    const credentials: SalesforceCredentials = JSON.parse(
      secretResponse.SecretString
    );

    // Process each SNS record
    for (const record of event.Records) {
      const message = JSON.parse(record.Sns.Message);
      logger.info('Processing message', { messageId: record.Sns.MessageId });

      // TODO: Implement Salesforce API calls based on message type
      switch (message.eventType) {
        case 'PAYMENT_STATUS_UPDATE':
          await handlePaymentStatusUpdate(message as never, credentials);
          break;
        case 'PAYMENT_CREATED':
          await handlePaymentCreated(message as never, credentials);
          break;
        default:
          logger.warn('Unknown event type', { eventType: message.eventType });
      }
    }
  } catch (error) {
    logger.error('Error processing Salesforce sync event', { error });
    throw error;
  }
};
