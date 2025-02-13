import { Handler, CloudWatchLogsEvent } from 'aws-lambda';
import { IncomingWebhook } from '@slack/webhook';
import { Logger, LoggerService } from '@mu-ts/logger';
import { promisify } from 'util';
import { unzip } from 'zlib';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL as string;

export class SlackNotifierService {
  private readonly logger: Logger;

  private readonly webhook: IncomingWebhook;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.webhook = new IncomingWebhook(SLACK_WEBHOOK_URL);
    this.logger.info('SlackNotifierService initialized');
  }

  public async processEvent(event: CloudWatchLogsEvent): Promise<void> {
    this.logger.info('Processing CloudWatchLogsEvent', { event });

    try {
      const buffer = Buffer.from(event.awslogs.data, 'base64');
      const unzipAsync = promisify(unzip);
      const unzippedBuffer = await unzipAsync(buffer);
      const resultObject = JSON.parse(unzippedBuffer.toString());

      const lambdaFunction = resultObject.logGroup;
      const logEvents = resultObject.logEvents;

      for (const logEvent of logEvents) {
        try {
          const rawMessage = logEvent.message;
          const messageParts = rawMessage.split('\t');
          const jsonPart = messageParts[messageParts.length - 1];

          let parsedMessage;
          try {
            parsedMessage = JSON.parse(jsonPart);
          } catch (err) {
            this.logger.warn('Failed to parse log message as JSON', {
              rawMessage,
            });
            continue;
          }

          const status = parsedMessage.level || 'ERROR';
          const errorMessage = parsedMessage.err?.message || parsedMessage.msg;

          await this.sendSlackNotification(
            lambdaFunction,
            status,
            errorMessage
          );
        } catch (innerError) {
          this.logger.error('Error processing individual log event', {
            innerError,
          });
        }
      }
    } catch (error) {
      this.logger.error('Error processing CloudWatchLogsEvent', { error });
    }
  }

  private async sendSlackNotification(
    lambdaFunction: string,
    status: string,
    errorMessage: string
  ): Promise<void> {
    const payload = {
      attachments: [
        {
          title: 'PAYQAM ERROR NOTIFIER',
          color: '#FF0000',
          fields: [
            {
              title: this.getTickedText('Lambda Function:'),
              value: this.codeBlock(lambdaFunction),
              short: false,
            },
            {
              title: this.getTickedText(`${status} Message:`),
              value: this.codeBlock(errorMessage),
              short: false,
            },
          ],
        },
      ],
    };

    await this.webhook.send(payload);
    this.logger.info('Slack message sent successfully');
  }

  private getTickedText(text: string): string {
    return `\`${text}\``;
  }

  private codeBlock(text: string): string {
    return `\`\`\`${text}\`\`\``;
  }
}

export const handler: Handler = async (event: CloudWatchLogsEvent) => {
  const service = new SlackNotifierService();
  await service.processEvent(event);
};
