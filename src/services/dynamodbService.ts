import {
  GetCommand,
  GetCommandOutput,
  NativeAttributeValue,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocClient } from '../dynamodbClient';
import { CreatePaymentRecord } from '../model';
import { buildUpdateExpression } from '../../utils/updateUtils';
import { removeNullValues } from '../../utils/removeNullValues';
import { ReturnValue } from '@aws-sdk/client-dynamodb';
import { Logger, LoggerService } from '@mu-ts/logger';

// Additional fields that might be present in a transaction record
interface AdditionalTransactionFields {
  paymentMethod?: string;
  paymentProviderResponse?: Record<string, unknown>;
  settlementStatus?: string;
  settlementId?: string;
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

  constructor() {
    this.logger = LoggerService.named(this.constructor.name);
    this.tableName = process.env.TRANSACTIONS_TABLE as string;
    this.dbClient = DynamoDBDocClient.getInstance();
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
      paymentProviderResponse: item.paymentProviderResponse,
      settlementStatus: item.settlementStatus,
      settlementId: item.settlementId,
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
   * Updates a payment record in the DynamoDB table using transaction ID.
   * This method first retrieves the record using GSI, then updates it using the primary key.
   *
   * @param transactionId - The transaction ID to update
   * @param updateFields - Fields to update (null values will be removed)
   */
  public async updatePaymentRecordByTransactionId<U>(
    transactionId: string,
    updateFields: U
  ): Promise<void> {
    // First get the record using GSI to obtain primary key
    const result = await this.getItem({ transactionId });
    if (!result) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    // Update the record using primary key
    await this.updatePaymentRecord({ transactionId }, updateFields);
  }

  /**
   * Retrieves an item from the DynamoDB table using GetItemCommand.
   *
   * @param key - The primary key of the record to retrieve.
   * @returns The retrieved item wrapped in a GetItemCommandOutput.
   */
  public async getItem<T>(key: T): Promise<GetCommandOutput> {
    console.log(`-----------key`, key);

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
}
