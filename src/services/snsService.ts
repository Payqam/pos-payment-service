import { PublishCommandInput } from '@aws-sdk/client-sns';
import { SNSClientWrapper } from '../snsClient';
import { Logger, LoggerService } from '@mu-ts/logger';

const logger: Logger = LoggerService.named('sns-service');

export class SNSService {
  private static instance: SNSService;
  private snsClientWrapper: SNSClientWrapper;
  private readonly topicArn: string;

  private constructor() {
    this.snsClientWrapper = SNSClientWrapper.getInstance();
    this.topicArn = process.env.TRANSACTION_STATUS_TOPIC_ARN as string;
  }

  public static getInstance(): SNSService {
    if (!SNSService.instance) {
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
    try {
      const messageString =
          typeof message === 'string' ? message : JSON.stringify(message);

      const input: PublishCommandInput = {
        TopicArn: this.topicArn,
        Message: messageString,
        MessageAttributes: messageAttributes,
      };

      logger.debug({ input }, 'Publishing message to SNS');
      const messageId = await this.snsClientWrapper.publishMessage(input);

      logger.info(
          { messageId, topicArn: this.topicArn },
          'Successfully published message to SNS'
      );

      return messageId;
    } catch (error) {
      logger.error(
          { error, topicArn: this.topicArn, message },
          'Error publishing message to SNS'
      );
      throw error;
    }
  }
}