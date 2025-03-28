import { Logger, LoggerService } from '@mu-ts/logger';
import { SQSEvent } from 'aws-lambda';
import { IncomingWebhook } from '@slack/webhook';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL as string;
const SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL as string;
const SES_DESTINATION_EMAIL = process.env.SES_DESTINATION_EMAIL as string;
const AWS_REGION = process.env.AWS_REGION;

export class DeadLetterQueueService {
  private readonly logger: Logger;

  private readonly webhook: IncomingWebhook;

  private readonly sesClient: SESClient;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.webhook = new IncomingWebhook(SLACK_WEBHOOK_URL);
    this.sesClient = new SESClient({ region: AWS_REGION });
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

        // Send notifications through both channels
        await Promise.all([
          this.sendSlackMessage(parsedMessage, record.messageId),
          this.sendEmailNotification(parsedMessage, record.messageId),
        ]);
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
        `🚨 *Salesforce Record Creation Failed * 🚨\n\n` +
        `*Message ID:* ${messageId}\n` +
        `*Content:* \`\`\`${typeof message === 'string' ? message : JSON.stringify(message, null, 2)}\`\`\``,
    };

    try {
      await this.webhook.send(slackPayload);
      this.logger.info('Slack message sent successfully');
    } catch (error) {
      this.logger.error('Failed to send Slack notification', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async sendEmailNotification(
    message: any,
    messageId: string
  ): Promise<void> {
    if (!SES_SOURCE_EMAIL || !SES_DESTINATION_EMAIL) {
      this.logger.warn(
        'SES email configuration missing, skipping email notification'
      );
      return;
    }

    const messageContent =
      typeof message === 'string' ? message : JSON.stringify(message, null, 2);

    const params = {
      Source: SES_SOURCE_EMAIL,
      Destination: {
        ToAddresses: [SES_DESTINATION_EMAIL],
      },
      Message: {
        Subject: {
          Data: `🚨 Salesforce Record Creation Failed - Message ID: ${messageId}`,
        },
        Body: {
          Text: {
            Data: `Salesforce Record Creation Failed\n\nMessage ID: ${messageId}\n\nContent:\n${messageContent}`,
          },
          Html: {
            Data: `
              <h2>🚨 Salesforce Record Creation Failed</h2>
              <p><strong>Message ID:</strong> ${messageId}</p>
              <p><strong>Content:</strong></p>
              <pre>${messageContent}</pre>
            `,
          },
        },
      },
    };

    try {
      const command = new SendEmailCommand(params);
      await this.sesClient.send(command);
      this.logger.info('Email notification sent successfully');
    } catch (error) {
      this.logger.error('Failed to send email notification', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}

export const handler = async (event: SQSEvent): Promise<void> => {
  const service = new DeadLetterQueueService();
  await service.processTransaction(event);
};
