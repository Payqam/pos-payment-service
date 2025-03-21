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
} from '@aws-sdk/lib-dynamodb';

export class DynamoDBDocClient {
  private static instance: DynamoDBDocClient;

  private docClient: DynamoDBDocumentClient;

  // Private constructor to enforce singleton usage.
  private constructor() {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION,
    });
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * Returns the singleton instance of the DynamoDBDocClient.
   */
  public static getInstance(): DynamoDBDocClient {
    if (!DynamoDBDocClient.instance) {
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
    return this.docClient.send(command);
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
    return this.docClient.send(command);
  }

  /**
   * Sends an AWS SDK command using the DynamoDB Document Client.
   *
   * @param command - The command to be sent.
   * @returns The result of the command.
   */
  public async getItem(command: GetCommand): Promise<GetCommandOutput> {
    return this.docClient.send(command);
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
    return this.docClient.send(command);
  }
}
