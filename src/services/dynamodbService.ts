import {
  GetCommand,
  GetCommandOutput,
  NativeAttributeValue,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocClient } from '../dynamodbClient';
import { CreatePaymentRecord } from '../model';
import { buildUpdateExpression } from '../../utils/updateUtils';
import { removeNullValues } from '../../utils/removeNullValues';
import { ReturnValue } from '@aws-sdk/client-dynamodb';
import { Logger, LoggerService } from '@mu-ts/logger';

interface AdditionalTransactionFields {
  paymentMethod?: string;
  paymentResponse?: Record<string, unknown>;
  disbursementResponse?: Record<string, unknown>;
  customerRefundResponse?: Record<string, unknown>[];
  merchantRefundResponse?: Record<string, unknown>[];
  totalCustomerRefundAmount?: number;
  totalMerchantRefundAmount?: number;
  uniqueId?: string;
  settlementDate?: number;
  fee?: number;
  settlementAmount?: number;
  merchantMobileNo?: string;
  [key: string]: unknown;
}

export interface TransactionRecord extends AdditionalTransactionFields {
  transactionId: string;
  status: string;
  createdOn: number;
  amount: number;
  currency: string;
  mobileNo: string;
  merchantId: string;
}

/**
 * Service for interacting with DynamoDB
 *
 * Table Structure:
 * - PK: {paymentMethod}#{status}#{year}#{month}
 * - SK: {timeStamp}#{transactionId}
 *
 * GSIs:
 * 1. TransactionIndex (PK: transactionId)
 * 2. MerchantIndex (PK: merchantId)
 */
export class DynamoDBService {
  private readonly logger: Logger;

  private readonly tableName: string;

  private dbClient: DynamoDBDocClient;

  private readonly maxRetries: number;

  private readonly baseDelayMS: number;

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.tableName = process.env.TRANSACTIONS_TABLE as string;
    this.dbClient = DynamoDBDocClient.getInstance();
    this.maxRetries = 5;
    this.baseDelayMS = 100;
    this.logger.info('init()');
  }

  /**
   * Maps DynamoDB item to TransactionRecord
   * @param item - Raw DynamoDB item
   * @returns Property typed TransactionRecord
   */
  private mapToTransactionRecord(
    item: Record<string, NativeAttributeValue>
  ): TransactionRecord {
    const [timestamp, transactionId] = item.sk.split('#');
    return {
      transactionId,
      status: item.status,
      createdOn: parseInt(timestamp),
      amount: item.amount,
      currency: item.currency,
      mobileNo: item.mobileNo,
      merchantId: item.merchantId,
      merchantMobileNo: item.merchantMobileNo,
      paymentMethod: item.paymentMethod,
      paymentResponse: item.paymentResponse,
      disbursementResponse: item.disbursementResponse,
      customerRefundResponse: item.customerRefundResponse,
      merchantRefundResponse: item.merchantRefundResponse,
      uniqueId: item.uniqueId,
      settlementDate: item.settlementDate,
      fee: item.fee,
      settlementAmount: item.settlementAmount,
    };
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

    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        await this.dbClient.sendCommand(new PutCommand(params));
        return;
      } catch (error: unknown) {
        if (
          !this.isRetryableError((error as Error).name) ||
          attempt === this.maxRetries - 1
        ) {
          this.logger.error('Error inserting record to DynamoDB', error);
          throw error;
        }

        const delay = this.calculateBackoffDelay(attempt);
        this.logger.warn(
          `Retrying insert (attempt ${attempt + 1}/${this.maxRetries}) after ${delay}ms due to ${(error as Error).name}`
        );
        await this.sleep(delay);
        attempt++;
      }
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

    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        await this.dbClient.updateCommandAsync(new UpdateCommand(params));
        return;
      } catch (error: unknown) {
        if (
          !this.isRetryableError((error as Error).name) ||
          attempt === this.maxRetries - 1
        ) {
          this.logger.error('Error updating record in DynamoDB', error);
          throw error;
        }

        const delay = this.calculateBackoffDelay(attempt);
        this.logger.warn(
          `Retrying update (attempt ${attempt + 1}/${this.maxRetries}) after ${delay}ms due to ${(error as Error).name}`
        );
        await this.sleep(delay);
        attempt++;
      }
    }
  }

  /**
   * Retrieves an item from the DynamoDB table using GetItemCommand.
   *
   * @param key - The primary key of the record to retrieve.
   * @param indexName - Optional. The name of the GSI to query.
   * @returns The retrieved item wrapped in a GetCommandOutput.
   */
  public async getItem<T>(
    key: T,
    indexName?: string
  ): Promise<GetCommandOutput> {
    const params: {
      TableName: string;
      IndexName?: string;
      Key: Record<string, NativeAttributeValue>;
    } = {
      TableName: this.tableName,
      Key: key as Record<string, NativeAttributeValue>,
    };

    if (indexName) {
      params.IndexName = indexName;
    }

    try {
      const result = await this.dbClient.getItem(new GetCommand(params));
      return result as GetCommandOutput;
    } catch (error) {
      this.logger.error('Error retrieving record from DynamoDB', error);
      throw error;
    }
  }

  /**
   * Queries an item using a Global Secondary Index
   *
   * @param key - Key to query with (e.g., { uniqueId: 'xyz' })
   * @param indexName - Name of the GSI to use
   * @returns The first matching item, if any
   */

  public async queryByGSI(
    key:
      | { uniqueId: string }
      | { customerRefundId: string }
      | { merchantRefundId: string },
    indexName: string
  ): Promise<QueryCommandOutput> {
    try {
      const attributeName = Object.keys(key)[0];
      const attributeValue = (key as Record<string, string>)[attributeName];

      const params = new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: {
          '#pk': attributeName,
        },
        ExpressionAttributeValues: {
          ':pk': attributeValue,
        },
        Limit: 1, // We only need one item
      });

      return await this.dbClient.queryCommand(params);
    } catch (error) {
      this.logger.error('Error querying record from DynamoDB using GSI', {
        error,
        key,
        indexName,
      });
      throw error;
    }
  }

  /**
   * Checks if an error is retryable or not.
   * @param error
   * @private
   */
  private isRetryableError(error: unknown): boolean {
    const retryableErrors = [
      'ItemCollectionSizeLimitExceededException',
      'ThrottlingException',
      'LimitExceededException',
      'ProvisionedThroughputExceededException',
      'RequestLimitExceeded',
      'UnrecognizedClientException',
    ];
    return retryableErrors.includes(error as string);
  }

  /**
   * Calculates the backoff delay for a retry attempt.
   * @param attempt
   * @private
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = this.baseDelayMS * Math.pow(2, attempt);
    const jitter = Math.random() * baseDelay;
    return baseDelay + jitter;
  }

  /**
   * Sleeps for a given number of milliseconds.
   * @param ms
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
