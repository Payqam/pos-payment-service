import { PublishCommandInput } from '@aws-sdk/client-sns';
import { SNSClientWrapper } from '../snsClient';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  maskSensitiveValue,
  registerRedactFilter,
  SENSITIVE_FIELDS,
} from '../../utils/redactUtil';
import {
  EnhancedError,
  ErrorCategory,
  ErrorMetadata,
} from '../../utils/errorHandler';

// Register additional sensitive fields specific to SNS operations
const snsSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'TopicArn',
  'MessageId',
  'Message',
  'MessageAttributes',
  'PhoneNumber',
  'Subject',
  'TargetArn',
];

registerRedactFilter(snsSensitiveFields);

const logger: Logger = LoggerService.named('sns-service');

export class SNSService {
  private static instance: SNSService;

  private snsClientWrapper: SNSClientWrapper;

  private readonly topicArn: string;

  private constructor() {
    this.snsClientWrapper = SNSClientWrapper.getInstance();
    this.topicArn = process.env.TRANSACTION_STATUS_TOPIC_ARN as string;

    logger.debug('SNSService initialized', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      maskedTopicArn: this.topicArn
        ? maskSensitiveValue(this.topicArn, '*', 8)
        : 'undefined',
    });
  }

  public static getInstance(): SNSService {
    if (!SNSService.instance) {
      logger.debug('Creating new SNSService instance');
      SNSService.instance = new SNSService();
    }
    return SNSService.instance;
  }

  /**
   * Publishes a message to an SNS topic
   * @param message - The message to publish (will be stringified if object)
   * @param messageAttributes - Optional message attributes
   * @returns Promise<string> - The message ID if successful
   * @throws Error if publishing fails
   */
  public async publish(
    message: string | object,
    messageAttributes?: Record<string, never>
  ): Promise<string> {
    const operationContext = {
      operation: 'publish',
      maskedTopicArn: maskSensitiveValue(this.topicArn, '*', 8),
      messageType: typeof message,
      messageSize:
        typeof message === 'string'
          ? message.length
          : JSON.stringify(message).length,
      hasMessageAttributes: !!messageAttributes,
      attributeCount: messageAttributes
        ? Object.keys(messageAttributes).length
        : 0,
      startTime: Date.now(),
    };

    logger.debug('Preparing to publish message to SNS', operationContext);

    try {
      const messageString =
        typeof message === 'string' ? message : JSON.stringify(message);

      // Create a masked version of the message for logging
      const maskedMessage =
        messageString.length > 100
          ? `${maskSensitiveValue(messageString.substring(0, 50), '*', 4)}...${maskSensitiveValue(messageString.substring(messageString.length - 20), '*', 4)}`
          : maskSensitiveValue(messageString, '*', 10);

      const input: PublishCommandInput = {
        TopicArn: this.topicArn,
        Message: messageString,
        MessageAttributes: messageAttributes,
      };

      logger.debug('Publishing message to SNS', {
        ...operationContext,
        maskedMessage,
        inputKeys: Object.keys(input),
      });

      const messageId = await this.snsClientWrapper.publishMessage(input);

      logger.debug('Successfully published message to SNS', {
        ...operationContext,
        messageId: maskSensitiveValue(messageId, '*', 4),
        durationMs: Date.now() - operationContext.startTime,
      });

      return messageId;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      logger.error('Error publishing message to SNS', errorContext);

      if (error instanceof Error) {
        const errorMetadata: ErrorMetadata = {
          retryable: true, // SNS publish failures are often retryable
          suggestedAction: 'Check SNS topic ARN and message format',
          originalError: error,
        };

        throw new EnhancedError(
          'SNS_PUBLISH_ERROR',
          ErrorCategory.SYSTEM_ERROR,
          `Failed to publish message to SNS topic ${maskSensitiveValue(this.topicArn, '*', 8)}`,
          errorMetadata
        );
      }

      throw error;
    }
  }
}
