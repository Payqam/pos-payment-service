import { Logger, LoggerService } from '@mu-ts/logger';
import { SQSEvent } from 'aws-lambda';
import { IncomingWebhook } from '@slack/webhook';
import {
  registerRedactFilter,
  maskSensitiveValue,
} from '../../../utils/redactUtil';
import { EnhancedError, ErrorCategory } from '../../../utils/errorHandler';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL as string;

// Register redaction filter for masking sensitive data in logs
registerRedactFilter();

export class DeadLetterQueueService {
  private readonly logger: Logger;

  private readonly webhook: IncomingWebhook;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.webhook = new IncomingWebhook(SLACK_WEBHOOK_URL);
    this.logger.debug('DeadLetterQueueService initialized', {
      webhookConfigured: !!SLACK_WEBHOOK_URL,
    });
  }

  public async processTransaction(event: SQSEvent): Promise<void> {
    this.logger.debug('Received DLQ event', {
      recordCount: event.Records.length,
      eventSource: event.Records[0]?.eventSource,
      eventTime: new Date().toISOString(),
    });

    for (const record of event.Records) {
      const messageContext = {
        messageId: record.messageId,
        messageSource: record.eventSource,
        receiptHandle: maskSensitiveValue(record.receiptHandle, '*', 4),
      };

      this.logger.debug('Processing failed SQS message', messageContext);

      try {
        let parsedMessage: any;
        try {
          parsedMessage = JSON.parse(record.body);
          this.logger.debug(
            'Successfully parsed message body as JSON',
            messageContext
          );
        } catch (parseError) {
          this.logger.warn(
            'Failed to parse message body as JSON, using raw body',
            {
              ...messageContext,
              error:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
              bodyLength: record.body.length,
            }
          );
          parsedMessage = record.body;
        }

        // Mask any potential sensitive information in the parsed message
        const maskedMessage = this.maskSensitiveMessageData(parsedMessage);

        this.logger.debug('Processed message content', {
          ...messageContext,
          messageType: typeof maskedMessage,
          hasTransactionId: !!maskedMessage?.transactionId,
        });

        const startTime = Date.now();
        await this.sendSlackMessage(maskedMessage, record.messageId);
        this.logger.debug('Slack notification processing completed', {
          ...messageContext,
          processingTimeMs: Date.now() - startTime,
        });
      } catch (error) {
        this.logger.error('Failed to process DLQ message', {
          ...messageContext,
          error: error instanceof Error ? error.message : String(error),
          stackTrace: error instanceof Error ? error.stack : undefined,
        });
      }
    }
  }

  /**
   * Masks sensitive data in message content before sending to Slack
   * @param message - The message to mask
   * @returns Masked message with sensitive data redacted
   */
  private maskSensitiveMessageData(message: any): any {
    if (typeof message !== 'object' || message === null) {
      return message;
    }

    // List of fields to mask in the message
    const sensitiveFields = [
      'customerPhone',
      'mobileNo',
      'merchantMobileNo',
      'phoneNumber',
      'email',
      'cardNumber',
      'token',
      'apiKey',
      'secret',
      'password',
    ];

    // Create a deep copy to avoid modifying the original
    const maskedMessage = JSON.parse(JSON.stringify(message));

    // Recursively mask sensitive fields
    const maskObject = (obj: any) => {
      if (typeof obj !== 'object' || obj === null) {
        return;
      }

      Object.keys(obj).forEach((key) => {
        if (sensitiveFields.includes(key) && typeof obj[key] === 'string') {
          obj[key] = maskSensitiveValue(obj[key], '*', 2);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          maskObject(obj[key]);
        }
      });
    };

    maskObject(maskedMessage);
    return maskedMessage;
  }

  private async sendSlackMessage(
    message: any,
    messageId: string
  ): Promise<void> {
    const messageContext = { messageId };
    this.logger.debug('Preparing Slack notification', messageContext);

    // Format message for Slack with proper masking
    let messageContent: string;
    try {
      if (typeof message === 'string') {
        messageContent = message;
      } else {
        messageContent = JSON.stringify(message, null, 2);
      }

      this.logger.debug('Message formatted for Slack', {
        ...messageContext,
        contentLength: messageContent.length,
      });
    } catch (formatError) {
      this.logger.error('Error formatting message for Slack', {
        ...messageContext,
        error:
          formatError instanceof Error
            ? formatError.message
            : String(formatError),
      });
      messageContent = 'Error formatting message content';
    }

    const slackPayload = {
      text:
        `🚨 *Failed SNS Message Received* 🚨\n\n` +
        `*Message ID:* ${messageId}\n` +
        `*Timestamp:* ${new Date().toISOString()}\n` +
        `*Environment:* ${process.env.ENVIRONMENT || 'unknown'}\n` +
        `*Content:* \`\`\`${messageContent}\`\`\``,
    };

    try {
      const startTime = Date.now();
      await this.webhook.send(slackPayload);
      this.logger.debug('Slack message sent successfully', {
        ...messageContext,
        responseTimeMs: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error('Failed to send Slack notification', {
        ...messageContext,
        error: error instanceof Error ? error.message : String(error),
        webhookUrl: SLACK_WEBHOOK_URL
          ? `${SLACK_WEBHOOK_URL.substring(0, 15)}...`
          : 'undefined',
      });

      throw new EnhancedError(
        'SLACK_NOTIFICATION_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to send Slack notification',
        {
          retryable: true,
          originalError: error,
        }
      );
    }
  }
}

export const handler = async (event: SQSEvent): Promise<void> => {
  const service = new DeadLetterQueueService();
  const startTime = Date.now();

  try {
    await service.processTransaction(event);
    LoggerService.named('DLQProcessor').debug(
      'DLQ processing completed successfully',
      {
        recordCount: event.Records.length,
        processingTimeMs: Date.now() - startTime,
      }
    );
  } catch (error) {
    LoggerService.named('DLQProcessor').error(
      'Unhandled exception in DLQ processor',
      {
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        processingTimeMs: Date.now() - startTime,
      }
    );
    throw error;
  }
};
