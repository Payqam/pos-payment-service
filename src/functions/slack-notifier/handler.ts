import { Handler, CloudWatchLogsEvent } from 'aws-lambda';
import { IncomingWebhook } from '@slack/webhook';
import { Logger, LoggerService } from '@mu-ts/logger';
import { promisify } from 'util';
import { unzip } from 'zlib';
import {
  registerRedactFilter,
  maskSensitiveValue,
} from '../../../utils/redactUtil';
import { EnhancedError, ErrorCategory } from '../../../utils/errorHandler';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL as string;

// Register redaction filter for masking sensitive data in logs
registerRedactFilter();

// Additional sensitive patterns to mask in log messages
const SENSITIVE_PATTERNS = [
  // API Keys, Tokens, and Credentials
  /api[_-]?key[=:]\s*([A-Za-z0-9_-]{10,})/gi,
  /token[=:]\s*([A-Za-z0-9_\-.]{10,})/gi,
  /password[=:]\s*([^\s&"]{3,})/gi,
  /secret[=:]\s*([A-Za-z0-9_-]{8,})/gi,

  // Personal Identifiable Information (PII)
  /\b\d{10,15}\b/g, // Phone numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // Email addresses

  // Financial Information
  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g, // Credit card numbers
  /\baccount[_-]?(?:id|number|#)[=:]\s*([A-Za-z0-9_-]{4,})/gi,

  // Transaction IDs and References
  /\b(?:txn|transaction)[_-]?(?:id|ref)[=:]\s*([A-Za-z0-9_-]{10,})/gi,
];

export class SlackNotifierService {
  private readonly logger: Logger;

  private readonly webhook: IncomingWebhook;

  private readonly startTime: number;

  constructor() {
    this.startTime = Date.now();
    this.logger = LoggerService.named(this.constructor.name);
    this.webhook = new IncomingWebhook(SLACK_WEBHOOK_URL);
    this.logger.debug('SlackNotifierService initialized', {
      webhookConfigured: !!SLACK_WEBHOOK_URL,
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
    });
  }

  /**
   * Process CloudWatch Logs event and send notifications for errors
   * @param event - CloudWatch Logs event containing compressed log data
   */
  public async processEvent(event: CloudWatchLogsEvent): Promise<void> {
    const operationContext = {
      startTime: Date.now(),
      awsRequestId: process.env.AWS_REQUEST_ID || 'unknown',
      hasData: !!event.awslogs?.data,
    };

    this.logger.debug('Processing CloudWatchLogsEvent', operationContext);

    try {
      if (!event.awslogs?.data) {
        this.logger.error(
          'Invalid CloudWatch Logs event: missing data',
          operationContext
        );
        throw new EnhancedError(
          'INVALID_CLOUDWATCH_EVENT',
          ErrorCategory.VALIDATION_ERROR,
          'CloudWatch Logs event is missing data',
          { retryable: false }
        );
      }

      // Decode and decompress the log data
      const buffer = Buffer.from(event.awslogs.data, 'base64');
      const unzipAsync = promisify(unzip);

      this.logger.debug('Decompressing CloudWatch log data', {
        ...operationContext,
        bufferSize: buffer.length,
      });

      const unzippedBuffer = await unzipAsync(buffer);
      const resultObject = JSON.parse(unzippedBuffer.toString());

      const lambdaFunction = resultObject.logGroup;
      const logEvents = resultObject.logEvents || [];

      this.logger.debug('Parsed CloudWatch log data', {
        ...operationContext,
        logGroup: lambdaFunction,
        logStreamName: resultObject.logStream,
        eventCount: logEvents.length,
        messageType: resultObject.messageType,
        owner: resultObject.owner,
      });

      let processedCount = 0;
      let errorCount = 0;

      for (const logEvent of logEvents) {
        const eventContext = {
          eventId: logEvent.id,
          timestamp: new Date(logEvent.timestamp).toISOString(),
          startTime: Date.now(),
        };

        try {
          this.logger.debug('Processing log event', eventContext);

          const rawMessage = logEvent.message;
          const messageParts = rawMessage.split('\t');
          const jsonPart = messageParts[messageParts.length - 1];

          let parsedMessage;
          try {
            parsedMessage = JSON.parse(jsonPart);
            this.logger.debug('Successfully parsed log message as JSON', {
              ...eventContext,
              level: parsedMessage.level,
              hasError: !!parsedMessage.err,
            });
          } catch (err) {
            this.logger.warn('Failed to parse log message as JSON', {
              ...eventContext,
              error: err instanceof Error ? err.message : String(err),
              rawMessageLength: rawMessage.length,
            });
            continue;
          }

          // Only process ERROR level logs or logs with error objects
          const status = parsedMessage.level || 'ERROR';
          if (status !== 'ERROR' && !parsedMessage.err) {
            this.logger.debug('Skipping non-error log event', {
              ...eventContext,
              level: status,
            });
            continue;
          }

          // Extract error message with sensitive data masked
          const errorMessage = this.maskSensitiveData(
            parsedMessage.err?.message || parsedMessage.msg || 'Unknown error'
          );

          // Extract additional context for better error reporting
          const errorContext =
            parsedMessage.err?.context || parsedMessage.context || {};
          const maskedContext = this.maskSensitiveDataInObject(errorContext);

          this.logger.debug('Sending error notification to Slack', {
            ...eventContext,
            errorType: parsedMessage.err?.name || 'Error',
            hasStackTrace: !!parsedMessage.err?.stack,
            hasContext: Object.keys(maskedContext).length > 0,
          });

          await this.sendSlackNotification(
            lambdaFunction,
            status,
            errorMessage,
            maskedContext,
            parsedMessage.err?.stack
          );

          this.logger.debug('Successfully sent notification for log event', {
            ...eventContext,
            processingTimeMs: Date.now() - eventContext.startTime,
          });

          processedCount++;
        } catch (innerError) {
          errorCount++;
          this.logger.error('Error processing individual log event', {
            ...eventContext,
            error:
              innerError instanceof Error
                ? innerError.message
                : String(innerError),
            stackTrace:
              innerError instanceof Error ? innerError.stack : undefined,
            processingTimeMs: Date.now() - eventContext.startTime,
          });
        }
      }

      this.logger.debug('Completed processing all log events', {
        ...operationContext,
        totalEvents: logEvents.length,
        processedCount,
        errorCount,
        processingTimeMs: Date.now() - operationContext.startTime,
      });
    } catch (error) {
      this.logger.error('Error processing CloudWatchLogsEvent', {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        processingTimeMs: Date.now() - operationContext.startTime,
      });

      throw new EnhancedError(
        'CLOUDWATCH_PROCESSING_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to process CloudWatch logs event',
        {
          retryable: true,
          originalError: error,
        }
      );
    }
  }

  /**
   * Mask sensitive data in a string using predefined patterns
   * @param text - Text to mask sensitive data in
   * @returns Text with sensitive data masked
   */
  private maskSensitiveData(text: string): string {
    if (!text) return text;

    let maskedText = text;

    // Apply each regex pattern to mask sensitive data
    SENSITIVE_PATTERNS.forEach((pattern) => {
      maskedText = maskedText.replace(pattern, (match, group) => {
        if (group) {
          // If there's a capture group, replace just that part
          return match.replace(group, '***REDACTED***');
        }
        // Otherwise mask the entire match
        return '***REDACTED***';
      });
    });

    return maskedText;
  }

  /**
   * Recursively mask sensitive data in an object
   * @param obj - Object to mask sensitive data in
   * @returns Object with sensitive data masked
   */
  private maskSensitiveDataInObject(
    obj: Record<string, any>
  ): Record<string, any> {
    if (!obj || typeof obj !== 'object') return obj;

    const result: Record<string, any> = {};

    // List of sensitive field names to mask completely
    const sensitiveFields = [
      'password',
      'secret',
      'token',
      'key',
      'apiKey',
      'api_key',
      'authorization',
      'auth',
      'credential',
      'phone',
      'mobile',
      'email',
      'card',
      'account',
    ];

    Object.entries(obj).forEach(([key, value]) => {
      // Check if this is a sensitive field
      const isSensitiveField = sensitiveFields.some((field) =>
        key.toLowerCase().includes(field.toLowerCase())
      );

      if (isSensitiveField && typeof value === 'string') {
        // Mask sensitive string values
        result[key] = maskSensitiveValue(value, '*', 2);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively process nested objects
        result[key] = this.maskSensitiveDataInObject(value);
      } else if (typeof value === 'string') {
        // Check if string value contains sensitive data
        result[key] = this.maskSensitiveData(value);
      } else {
        // Keep non-string values as is
        result[key] = value;
      }
    });

    return result;
  }

  /**
   * Send a notification to Slack with error details
   * @param lambdaFunction - Name of the Lambda function
   * @param status - Error status/level
   * @param errorMessage - Error message
   * @param context - Additional context for the error
   * @param stackTrace - Error stack trace if available
   */
  private async sendSlackNotification(
    lambdaFunction: string,
    status: string,
    errorMessage: string,
    context: Record<string, any> = {},
    stackTrace?: string
  ): Promise<void> {
    const operationContext = {
      lambdaFunction,
      status,
      startTime: Date.now(),
    };

    this.logger.debug('Preparing Slack notification payload', operationContext);

    // Format context as a string if it exists
    let contextBlock = '';
    if (Object.keys(context).length > 0) {
      try {
        contextBlock = `\n*Context:*\n${this.codeBlock(JSON.stringify(context, null, 2))}`;
      } catch (err) {
        this.logger.warn('Failed to stringify context object', {
          ...operationContext,
          error: err instanceof Error ? err.message : String(err),
        });
        contextBlock = '\n*Context:* [Error formatting context]';
      }
    }

    // Format stack trace if available
    let stackTraceBlock = '';
    if (stackTrace) {
      // Truncate stack trace if too long
      const maxStackLength = 1000;
      const truncatedStack =
        stackTrace.length > maxStackLength
          ? stackTrace.substring(0, maxStackLength) + '...[truncated]'
          : stackTrace;

      stackTraceBlock = `\n*Stack Trace:*\n${this.codeBlock(truncatedStack)}`;
    }

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
          footer: `Environment: ${process.env.ENVIRONMENT || 'unknown'} | Time: ${new Date().toISOString()}`,
          ts: Math.floor(Date.now() / 1000).toString(),
        },
      ],
      text: contextBlock + stackTraceBlock,
    };

    try {
      await this.webhook.send(payload);
      this.logger.debug('Slack message sent successfully', {
        ...operationContext,
        responseTimeMs: Date.now() - operationContext.startTime,
      });
    } catch (error) {
      this.logger.error('Failed to send Slack notification', {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        webhookUrl: SLACK_WEBHOOK_URL
          ? `${SLACK_WEBHOOK_URL.substring(0, 15)}...`
          : 'undefined',
        responseTimeMs: Date.now() - operationContext.startTime,
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

  private getTickedText(text: string): string {
    return `\`${text}\``;
  }

  private codeBlock(text: string): string {
    return `\`\`\`${text}\`\`\``;
  }
}

export const handler: Handler = async (event: CloudWatchLogsEvent) => {
  const logger = LoggerService.named('SlackNotifier');
  const startTime = Date.now();

  try {
    logger.debug('Starting Slack notifier handler', {
      hasData: !!event.awslogs?.data,
      timestamp: new Date().toISOString(),
      requestId: process.env.AWS_REQUEST_ID || 'unknown',
    });

    const service = new SlackNotifierService();
    await service.processEvent(event);

    logger.debug('Slack notifier handler completed successfully', {
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Unhandled exception in Slack notifier handler', {
      error: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
};
