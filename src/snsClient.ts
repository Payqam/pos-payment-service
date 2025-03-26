import {
  SNSClient,
  PublishCommand,
  PublishCommandInput,
} from '@aws-sdk/client-sns';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  maskSensitiveValue,
  registerRedactFilter,
  SENSITIVE_FIELDS,
} from '../utils/redactUtil';

// Register additional sensitive fields specific to SNS operations
const snsSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'TopicArn',
  'TargetArn',
  'PhoneNumber',
  'Message',
  'Subject',
  'MessageAttributes',
  'MessageStructure',
  'MessageDeduplicationId',
  'MessageGroupId',
];

registerRedactFilter(snsSensitiveFields);

export class SNSClientWrapper {
  private static instance: SNSClientWrapper;

  private snsClient: SNSClient;

  private readonly logger: Logger;

  private constructor() {
    const region = process.env.AWS_REGION;

    this.logger = LoggerService.named(this.constructor.name);

    this.logger.debug('Initializing SNSClientWrapper', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      region,
    });

    this.snsClient = new SNSClient({
      region,
    });

    this.logger.debug('SNSClientWrapper initialized', {
      timestamp: new Date().toISOString(),
      region,
    });
  }

  /**
   * Returns the singleton instance of the SNSClientWrapper.
   */
  public static getInstance(): SNSClientWrapper {
    if (!SNSClientWrapper.instance) {
      LoggerService.named('SNSClientWrapper').debug(
        'Creating new SNSClientWrapper instance'
      );
      SNSClientWrapper.instance = new SNSClientWrapper();
    }
    return SNSClientWrapper.instance;
  }

  /**
   * Publishes a message to an SNS topic.
   * @param input - The publish command input.
   * @returns Promise<string> - The message ID if successful.
   */
  public async publishMessage(input: PublishCommandInput): Promise<string> {
    const operationContext = {
      operation: 'publishMessage',
      topicArn: input.TopicArn
        ? maskSensitiveValue(input.TopicArn, '*', 8)
        : undefined,
      targetArn: input.TargetArn
        ? maskSensitiveValue(input.TargetArn, '*', 8)
        : undefined,
      phoneNumber: input.PhoneNumber
        ? maskSensitiveValue(input.PhoneNumber, '*', 4)
        : undefined,
      messageLength: input.Message ? input.Message.length : 0,
      hasSubject: !!input.Subject,
      hasMessageAttributes:
        !!input.MessageAttributes &&
        Object.keys(input.MessageAttributes || {}).length > 0,
      messageAttributeKeys: input.MessageAttributes
        ? Object.keys(input.MessageAttributes)
        : [],
      messageStructure: input.MessageStructure,
      hasDeduplicationId: !!input.MessageDeduplicationId,
      hasMessageGroupId: !!input.MessageGroupId,
      startTime: Date.now(),
    };

    this.logger.debug('Publishing message to SNS', operationContext);

    try {
      const command = new PublishCommand(input);

      this.logger.debug('SNS PublishCommand created', {
        ...operationContext,
        commandName: command.constructor.name,
      });

      const response = await this.snsClient.send(command);

      this.logger.debug('Message published successfully to SNS', {
        ...operationContext,
        statusCode: response.$metadata.httpStatusCode,
        requestId: response.$metadata.requestId,
        messageId: response.MessageId
          ? maskSensitiveValue(response.MessageId, '*', 4)
          : undefined,
        sequenceNumber: response.SequenceNumber,
        durationMs: Date.now() - operationContext.startTime,
      });

      return response.MessageId!;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.error('Error publishing message to SNS', errorContext);
      throw error;
    }
  }
}
