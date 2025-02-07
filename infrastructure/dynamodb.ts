import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';

export interface DynamoDBConstructProps {
  envName: string;
  namespace: string;
  tableName: string;
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * DynamoDB Construct for transaction management
 *
 * Table Structure:
 * - Partition Key: {paymentMethod}#{status}#{year}#{month}
 *   Example: "mtn#SUCCESS#2024#02"
 *
 * - Sort Key: {timeStamp}#{transactionId}
 *   Example: "1707305731#tx_123456"
 *
 * Global Secondary Indexes:
 * 1. TransactionIndex
 *    - PK: transactionId
 *    For direct transaction lookups
 *
 * 2. MerchantIndex
 *    - PK: merchantId
 *    For querying transactions by merchant
 */
export class DynamoDBConstruct extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DynamoDBConstructProps) {
    super(scope, id);

    // Create the main DynamoDB table
    this.table = new dynamodb.Table(this, `${props.namespace}-Table`, {
      tableName: `${props.tableName}`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING, // {paymentMethod}#{status}#{year}#{month}
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING, // {timeStamp}#{transactionId}
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI for transaction ID lookups
    this.table.addGlobalSecondaryIndex({
      indexName: 'TransactionIndex',
      partitionKey: {
        name: 'transactionId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for merchant queries
    this.table.addGlobalSecondaryIndex({
      indexName: 'MerchantIndex',
      partitionKey: {
        name: 'merchantId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }

  public grantReadWrite(grantee: cdk.aws_iam.IGrantable): void {
    this.table.grantReadWriteData(grantee);
  }

  public grantRead(grantee: cdk.aws_iam.IGrantable): void {
    this.table.grantReadData(grantee);
  }
}
