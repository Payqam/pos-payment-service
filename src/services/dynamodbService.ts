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

export interface CreatePaymentRecord {
  transactionId: string;
  status: string;
  amount: number;
  currency?: string;
  mobileNo?: string;
  merchantId?: string;
  paymentMethod: string;
  paymentProviderResponse?: Record<string, unknown>;
  metaData?: Record<string, unknown>;
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
   * @param record - A plain object representing the payment record
   */
  public async createPaymentRecord(record: CreatePaymentRecord): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');

    const params = {
      TableName: this.tableName,
      Item: {
        ...record,
        pk: `${record.paymentMethod}#${record.status}#${year}#${month}`,
        sk: `${timestamp}#${record.transactionId}`,
        transactionId: record.transactionId, // This is the GSI partition key
        createdOn: timestamp,
      },
    };

    try {
      this.logger.info('Creating payment record', {
        transactionId: record.transactionId,
        pk: params.Item.pk,
        sk: params.Item.sk,
      });
      await this.dbClient.sendCommand(new PutCommand(params));
    } catch (error) {
      this.logger.error('Error inserting record to DynamoDB', {
        error,
        transactionId: record.transactionId,
      });
      throw error;
    }
  }

  /**
   * Updates a payment record in the DynamoDB table.
   *
   * @param key - The primary key of the record to update
   * @param updateFields - Fields to update (null values will be removed)
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
   * Retrieves a transaction by its ID using the TransactionIndex GSI.
   *
   * @param transactionId - The ID of the transaction to retrieve
   * @returns The transaction record and primary key if found
   */
  public async getTransactionById(transactionId: string): Promise<{
    record: TransactionRecord;
    key: { pk: string; sk: string };
  } | null> {
    const params: QueryCommandInput = {
      TableName: this.tableName,
      IndexName: 'TransactionIndex',
      KeyConditionExpression: 'transactionId = :txId',
      ExpressionAttributeValues: {
        ':txId': transactionId,
      },
      Limit: 1,
    };

    try {
      this.logger.info('Retrieving transaction by ID', {
        transactionId,
        indexName: 'TransactionIndex',
      });
      const command = new QueryCommand(params);
      const result = await this.dbClient.queryCommand(command);

      if (!result.Items?.[0]) {
        this.logger.warn('Transaction not found', { transactionId });
        return null;
      }

      const item = result.Items[0];
      this.logger.info('Found transaction', {
        transactionId,
        pk: item.pk,
        sk: item.sk,
      });

      return {
        record: this.mapToTransactionRecord(item),
        key: {
          pk: item.pk,
          sk: item.sk,
        },
      };
    } catch (error) {
      this.logger.error('Error retrieving transaction by ID', {
        transactionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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
    const result = await this.getTransactionById(transactionId);
    if (!result) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    // Update the record using primary key
    await this.updatePaymentRecord(result.key, updateFields);
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
   * Queries transactions by payment method and status within a time range.
   *
   * @param paymentMethod - Payment method (e.g., 'mtn', 'stripe')
   * @param status - Transaction status
   * @param startTime - Start of time range (Unix timestamp)
   * @param endTime - End of time range (Unix timestamp)
   * @returns Array of matching transactions
   */
  public async queryByPaymentMethodAndStatus(
    paymentMethod: string,
    status: string,
    startTime: number,
    endTime: number
  ): Promise<TransactionRecord[]> {
    const startDate = new Date(startTime * 1000);
    const endDate = new Date(endTime * 1000);
    const endYear = endDate.getUTCFullYear();

    // Generate all year-month combinations between start and end dates
    const yearMonths: string[] = [];
    const currentDate = new Date(startDate);
    while (
      currentDate.getUTCFullYear() < endYear ||
      (currentDate.getUTCFullYear() === endYear &&
        currentDate.getUTCMonth() <= endDate.getUTCMonth())
    ) {
      const year = currentDate.getUTCFullYear();
      const month = String(currentDate.getUTCMonth() + 1).padStart(2, '0');
      yearMonths.push(`${year}#${month}`);
      currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
    }

    // Query each partition and combine results
    const allResults: TransactionRecord[] = [];
    for (const yearMonth of yearMonths) {
      const [year, month] = yearMonth.split('#');
      const params: QueryCommandInput = {
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :startKey AND :endKey',
        ExpressionAttributeValues: {
          ':pk': `${paymentMethod}#${status}#${year}#${month}`,
          ':startKey': `${startTime}`,
          ':endKey': `${endTime}`,
        },
      };

      try {
        const command = new QueryCommand(params);
        const result = await this.dbClient.queryCommand(command);
        if (result.Items) {
          allResults.push(
            ...result.Items.map((item) => this.mapToTransactionRecord(item))
          );
        }
      } catch (error) {
        this.logger.error(
          'Error querying records by payment method and status',
          {
            paymentMethod,
            status,
            yearMonth,
            error,
          }
        );
        // Continue with other partitions even if one fails
        continue;
      }
    }

    return allResults;
  }

  /**
   * Groups transactions by merchant ID
   *
   * @param transactions - Array of transactions to group
   * @returns Record with merchant IDs as keys and transaction arrays as values
   */
  public groupTransactionsByMerchant(
    transactions: TransactionRecord[]
  ): Record<string, TransactionRecord[]> {
    return transactions.reduce(
      (groups, transaction) => {
        const merchantId = transaction.merchantId;
        if (!groups[merchantId]) {
          groups[merchantId] = [];
        }
        groups[merchantId].push(transaction);
        return groups;
      },
      {} as Record<string, TransactionRecord[]>
    );
  }
}
