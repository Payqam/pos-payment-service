import { Logger, LoggerService } from '@mu-ts/logger';
import { SQSEvent } from 'aws-lambda';
import { IncomingWebhook } from '@slack/webhook';
import { registerRedactFilter } from '../../../utils/redactUtil';

const sensitiveFields = [
  'transactionId',
  'messageId',
  'uniqueId',
  'merchantMobileNo',
  'customerMobileNo',
  'partyId',
  'payToken',
  'txnid',
  'orderId',
  'subscriptionKey',
  'apiKey',
  'apiUser',
  'body',
];
registerRedactFilter(sensitiveFields);

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL as string;

export class DeadLetterQueueService {
  private readonly logger: Logger;

  private readonly webhook: IncomingWebhook;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.webhook = new IncomingWebhook(SLACK_WEBHOOK_URL);
    this.logger.info('DeadLetterQueueService initialized');
  }

  public async processTransaction(event: SQSEvent): Promise<void> {
    this.logger.info('Received event:', event);

    for (const record of event.Records) {
      this.logger.info(
        `Processing failed SQS message (ID: ${record.messageId})`
      );

      try {
        let parsedMessage: any;
        try {
          parsedMessage = JSON.parse(record.body);
        } catch {
          parsedMessage = record.body;
        }

        this.logger.info('Parsed message:', parsedMessage);

        this.logger.debug('Processing DLQ record', {
          messageId: record.messageId,
        });

        await this.sendSlackMessage(parsedMessage, record.messageId);

        this.logger.debug('Slack message sent successfully', {
          messageId: record.messageId,
        });
      } catch (error) {
        this.logger.error('Failed to process message', {
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  private async sendSlackMessage(
    message: any,
    messageId: string
  ): Promise<void> {
    const slackPayload = {
      text:
        `🚨 *Failed SNS Message Received* 🚨\n\n` +
        `*Message ID:* ${messageId}\n` +
        `*Content:* \`\`\`${typeof message === 'string' ? message : JSON.stringify(message, null, 2)}\`\`\``,
    };

    try {
      await this.webhook.send(slackPayload);
      this.logger.info('Slack message sent successfully');
      this.logger.debug('Slack notification sent', {
        messageId: message.messageId,
      });
    } catch (error) {
      this.logger.error('Failed to send Slack notification', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}

export const handler = async (event: SQSEvent): Promise<void> => {
  const service = new DeadLetterQueueService();
  await service.processTransaction(event);
};
