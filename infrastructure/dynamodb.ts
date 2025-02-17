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
 * - Partition Key: transactionId
 *   Example: "tx_123456"
 *
 * Global Secondary Indexes:
 * 1. GSI1
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
        name: 'transactionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI1 with merchantId as partition key
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'merchantId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI2 for settlement lookups
    this.table.addGlobalSecondaryIndex({
      indexName: 'SettlementIndex',
      partitionKey: {
        name: 'settlementId',
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
