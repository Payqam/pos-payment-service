import {
  GetCommand,
  GetCommandOutput,
  NativeAttributeValue,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocClient } from '../dynamodbClient';
import { CreatePaymentRecord } from '../model';
import { buildUpdateExpression } from '../../utils/updateUtils';
import { removeNullValues } from '../../utils/removeNullVavlues';
import { ReturnValue } from '@aws-sdk/client-dynamodb';
import { Logger, LoggerService } from '@mu-ts/logger';

// Additional fields that might be present in a transaction record
interface AdditionalTransactionFields {
  paymentMethod?: string;
  paymentProviderResponse?: Record<string, unknown>;
  settlementStatus?: string;
  settlementId?: string;
  settlementDate?: number;
  [key: string]: unknown;
}

export interface TransactionRecord extends AdditionalTransactionFields {
  transactionId: string;
  status: string;
  createdOn: number;
  amount: number;
  currency: string;
  mobileNo: string;
}

export class DynamoDBService {
  private readonly logger: Logger;

  private readonly tableName: string;

  private dbClient: DynamoDBDocClient;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.tableName = process.env.TRANSACTIONS_TABLE as string;
    this.dbClient = DynamoDBDocClient.getInstance();
    this.logger.info('init()');
  }

  /**
   * Creates a payment record in the DynamoDB table.
   *
   * @param record - A plain object representing the payment record.
   */
  public async createPaymentRecord(record: CreatePaymentRecord): Promise<void> {
    const params = {
      TableName: this.tableName,
      Item: record,
    };

    try {
      await this.dbClient.sendCommand(new PutCommand(params));
    } catch (error) {
      this.logger.error('Error inserting record to DynamoDB', error);
      throw error;
    }
  }

  /**
   * Updates a payment record in the DynamoDB table.
   *
   * @param key - The primary key of the record to update.
   * @param updateFields - An object containing the fields to update.
   *                     Any fields with null values will be removed.
   */
  public async updatePaymentRecord<T, U>(
    key: T,
    updateFields: U
  ): Promise<void> {
    const cleanedFields = removeNullValues({
      ...updateFields,
      updatedOn: Math.floor(Date.now() / 1000),
    });
    const expressionAttributeValues = {};
    const { updateExpression, expressionAttributeNames } =
      buildUpdateExpression(cleanedFields, expressionAttributeValues);
    const params = {
      TableName: this.tableName,
      Key: key as Record<string, NativeAttributeValue>,
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: ReturnValue.ALL_NEW,
    };

    try {
      await this.dbClient.updateCommandAsync(new UpdateCommand(params));
    } catch (error) {
      this.logger.error('Error updating record in DynamoDB', error);
      throw error;
    }
  }

  /**
   * Retrieves an item from the DynamoDB table using GetItemCommand.
   *
   * @param key - The primary key of the record to retrieve.
   * @returns The retrieved item wrapped in a GetItemCommandOutput.
   */
  public async getItem<T>(key: T): Promise<GetCommandOutput> {
    const params = {
      TableName: this.tableName,
      Key: key as Record<string, NativeAttributeValue>,
    };
    try {
      const result = await this.dbClient.getItem(new GetCommand(params));
      return result as GetCommandOutput;
    } catch (error) {
      this.logger.error('Error retrieving record from DynamoDB', error);
      throw error;
    }
  }

  /**
   * Queries transactions by status within a time range using StatusTimeIndex.
   *
   * @param status - Transaction status to query for
   * @param startTime - Start of time range in Unix timestamp (seconds)
   * @param endTime - End of time range in Unix timestamp (seconds)
   * @returns Array of transactions matching the criteria
   */
  public async queryByStatusAndTime(
    status: string,
    startTime: number,
    endTime: number
  ): Promise<TransactionRecord[]> {
    const params: QueryCommandInput = {
      TableName: this.tableName,
      IndexName: 'StatusTimeIndex',
      KeyConditionExpression:
        '#status = :status AND #createdOn BETWEEN :start AND :end',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#createdOn': 'createdOn',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':start': startTime,
        ':end': endTime,
      },
    };

    try {
      const command = new QueryCommand(params);
      const result = await this.dbClient.queryCommand(command);
      return (result.Items || []) as TransactionRecord[];
    } catch (error) {
      this.logger.error('Error querying records by status and time', {
        status,
        startTime,
        endTime,
        error,
      });
      throw error;
    }
  }
}
