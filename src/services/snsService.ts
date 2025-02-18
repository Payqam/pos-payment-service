import {
  SNSClient,
  PublishCommand,
  PublishCommandInput,
} from '@aws-sdk/client-sns';
import { Logger, LoggerService } from '@mu-ts/logger';

const logger: Logger = LoggerService.named('sns-service');

export class SNSService {
  private static instance: SNSService;

  private snsClient: SNSClient;

  private constructor() {
    this.snsClient = new SNSClient({
      region: process.env.AWS_REGION,
    });
  }

  public static getInstance(): SNSService {
    if (!SNSService.instance) {
      SNSService.instance = new SNSService();
    }
    return SNSService.instance;
  }

  /**
   * Publishes a message to an SNS topic
   * @param topicArn - The ARN of the SNS topic
   * @param message - The message to publish (will be stringified if object)
   * @param messageAttributes - Optional message attributes
   * @returns Promise<string> - The message ID if successful
   * @throws Error if publishing fails
   */
  public async publish(
    topicArn: string,
    message: string | object,
    messageAttributes?: Record<string, never>
  ): Promise<string> {
    try {
      const messageString =
        typeof message === 'string' ? message : JSON.stringify(message);

      const input: PublishCommandInput = {
        TopicArn: topicArn,
        Message: messageString,
        MessageAttributes: messageAttributes,
      };

      logger.debug({ input }, 'Publishing message to SNS');

      const command = new PublishCommand(input);
      const response = await this.snsClient.send(command);

      logger.info(
        { messageId: response.MessageId, topicArn },
        'Successfully published message to SNS'
      );

      return response.MessageId!;
    } catch (error) {
      logger.error(
        { error, topicArn, message },
        'Error publishing message to SNS'
      );
      throw error;
    }
  }

  /**
   * Publishes a batch of messages to an SNS topic
   * @param topicArn - The ARN of the SNS topic
   * @param messages - Array of messages to publish
   * @returns Promise<string[]> - Array of message IDs for successful publishes
   */
  public async publishBatch(
    topicArn: string,
    messages: (string | object)[]
  ): Promise<string[]> {
    try {
      const messageIds: string[] = [];

      // Process messages in parallel with a concurrency limit
      const batchSize = 10; // AWS SNS has a limit of 10 messages per batch
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        const promises = batch.map((message) =>
          this.publish(topicArn, message)
        );

        const results = await Promise.all(promises);
        messageIds.push(...results);
      }

      logger.info(
        { messageCount: messageIds.length, topicArn },
        'Successfully published batch messages to SNS'
      );

      return messageIds;
    } catch (error) {
      logger.error(
        { error, topicArn, messageCount: messages.length },
        'Error publishing batch messages to SNS'
      );
      throw error;
    }
  }
}
