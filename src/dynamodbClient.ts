import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommandOutput,
  PutCommand,
  UpdateCommand,
  UpdateCommandOutput,
  GetCommand,
  GetCommandOutput,
  QueryCommand,
  QueryCommandOutput,
  DeleteCommand,
  DeleteCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  maskSensitiveValue,
  registerRedactFilter,
  SENSITIVE_FIELDS,
} from '../utils/redactUtil';

// Register additional sensitive fields specific to DynamoDB operations
const dynamodbSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'TableName',
  'Key',
  'Item',
  'ExpressionAttributeValues',
  'KeyConditionExpression',
  'FilterExpression',
  'ProjectionExpression',
  'UpdateExpression',
];

registerRedactFilter(dynamodbSensitiveFields);

const logger: Logger = LoggerService.named('dynamodb-client');

export class DynamoDBDocClient {
  private static instance: DynamoDBDocClient;

  private docClient: DynamoDBDocumentClient;

  // Private constructor to enforce singleton usage.
  private constructor() {
    const region = process.env.AWS_REGION;

    logger.debug('Initializing DynamoDBDocClient', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      region,
    });

    const client = new DynamoDBClient({
      region,
    });
    this.docClient = DynamoDBDocumentClient.from(client);

    logger.debug('DynamoDBDocClient initialized', {
      timestamp: new Date().toISOString(),
      region,
    });
  }

  /**
   * Returns the singleton instance of the DynamoDBDocClient.
   */
  public static getInstance(): DynamoDBDocClient {
    if (!DynamoDBDocClient.instance) {
      logger.debug('Creating new DynamoDBDocClient instance');
      DynamoDBDocClient.instance = new DynamoDBDocClient();
    }
    return DynamoDBDocClient.instance;
  }

  /**
   * Sends an AWS SDK command using the DynamoDB Document Client.
   *
   * @param command - The command to be sent.
   * @returns The result of the command.
   */
  public async sendCommand(command: PutCommand): Promise<PutCommandOutput> {
    const operationContext = {
      operation: 'sendCommand',
      commandName: command.constructor.name,
      tableName: command.input.TableName
        ? maskSensitiveValue(command.input.TableName, '*', 4)
        : undefined,
      hasItem: !!command.input.Item,
      itemKeys: command.input.Item ? Object.keys(command.input.Item) : [],
      startTime: Date.now(),
    };

    logger.debug('Sending PutCommand to DynamoDB', operationContext);

    try {
      const result = await this.docClient.send(command);

      logger.debug('PutCommand completed successfully', {
        ...operationContext,
        statusCode: result.$metadata.httpStatusCode,
        requestId: result.$metadata.requestId,
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      logger.error('Error executing PutCommand', errorContext);
      throw error;
    }
  }

  /**
   * Sends an AWS SDK command using the DynamoDB Document Client.
   *
   * @param command - The command to be sent.
   * @returns The result of the command.
   */
  public async updateCommandAsync(
    command: UpdateCommand
  ): Promise<UpdateCommandOutput> {
    const operationContext = {
      operation: 'updateCommandAsync',
      commandName: command.constructor.name,
      tableName: command.input.TableName
        ? maskSensitiveValue(command.input.TableName, '*', 4)
        : undefined,
      hasKey: !!command.input.Key,
      keyAttributes: command.input.Key ? Object.keys(command.input.Key) : [],
      hasUpdateExpression: !!command.input.UpdateExpression,
      hasExpressionAttributeValues: !!command.input.ExpressionAttributeValues,
      startTime: Date.now(),
    };

    logger.debug('Sending UpdateCommand to DynamoDB', operationContext);

    try {
      const result = await this.docClient.send(command);

      logger.debug('UpdateCommand completed successfully', {
        ...operationContext,
        statusCode: result.$metadata.httpStatusCode,
        requestId: result.$metadata.requestId,
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      logger.error('Error executing UpdateCommand', errorContext);
      throw error;
    }
  }

  /**
   * Sends an AWS SDK command using the DynamoDB Document Client.
   *
   * @param command - The command to be sent.
   * @returns The result of the command.
   */
  public async getItem(command: GetCommand): Promise<GetCommandOutput> {
    const operationContext = {
      operation: 'getItem',
      commandName: command.constructor.name,
      tableName: command.input.TableName
        ? maskSensitiveValue(command.input.TableName, '*', 4)
        : undefined,
      hasKey: !!command.input.Key,
      keyAttributes: command.input.Key ? Object.keys(command.input.Key) : [],
      startTime: Date.now(),
    };

    logger.debug('Sending GetCommand to DynamoDB', operationContext);

    try {
      const result = await this.docClient.send(command);

      logger.debug('GetCommand completed successfully', {
        ...operationContext,
        statusCode: result.$metadata.httpStatusCode,
        requestId: result.$metadata.requestId,
        itemFound: !!result.Item,
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      logger.error('Error executing GetCommand', errorContext);
      throw error;
    }
  }

  /**
   * Sends a Query command using the DynamoDB Document Client.
   *
   * @param command - The Query command to be sent.
   * @returns The result of the query command.
   */
  public async queryCommand(
    command: QueryCommand
  ): Promise<QueryCommandOutput> {
    const operationContext = {
      operation: 'queryCommand',
      commandName: command.constructor.name,
      tableName: command.input.TableName
        ? maskSensitiveValue(command.input.TableName, '*', 4)
        : undefined,
      hasKeyConditionExpression: !!command.input.KeyConditionExpression,
      hasFilterExpression: !!command.input.FilterExpression,
      hasExpressionAttributeValues: !!command.input.ExpressionAttributeValues,
      hasIndexName: !!command.input.IndexName,
      indexName: command.input.IndexName
        ? maskSensitiveValue(command.input.IndexName, '*', 4)
        : undefined,
      limit: command.input.Limit,
      startTime: Date.now(),
    };

    logger.debug('Sending QueryCommand to DynamoDB', operationContext);

    try {
      const result = await this.docClient.send(command);

      logger.debug('QueryCommand completed successfully', {
        ...operationContext,
        statusCode: result.$metadata.httpStatusCode,
        requestId: result.$metadata.requestId,
        itemCount: result.Items?.length || 0,
        hasLastEvaluatedKey: !!result.LastEvaluatedKey,
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      logger.error('Error executing QueryCommand', errorContext);
      throw error;
    }
  }

  /**
   * Sends a Delete command using the DynamoDB Document Client.
   * This method is used to delete an item from a DynamoDB table.
   *
   * @param command - The Delete command to be sent.
   * @returns The result of the delete command.
   */
  public async deleteItem(
    command: DeleteCommand
  ): Promise<DeleteCommandOutput> {
    const operationContext = {
      operation: 'deleteItem',
      commandName: command.constructor.name,
      tableName: command.input.TableName
        ? maskSensitiveValue(command.input.TableName, '*', 4)
        : undefined,
      hasKey: !!command.input.Key,
      keyAttributes: command.input.Key ? Object.keys(command.input.Key) : [],
      startTime: Date.now(),
    };

    logger.debug('Sending DeleteCommand to DynamoDB', operationContext);

    try {
      const result = await this.docClient.send(command);

      logger.debug('DeleteCommand completed successfully', {
        ...operationContext,
        statusCode: result.$metadata.httpStatusCode,
        requestId: result.$metadata.requestId,
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      logger.error('Error executing DeleteCommand', errorContext);
      throw error;
    }
  }
}
