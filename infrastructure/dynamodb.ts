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

    // Read environment variable (default is "false")
    const enableProvisioning =
      process.env.ENABLE_DYNAMODB_PROVISIONING === 'true';

    // Create the main DynamoDB table
    this.table = new dynamodb.Table(this, `${props.namespace}-Table`, {
      tableName: `${props.tableName}`,
      partitionKey: {
        name: 'transactionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: enableProvisioning
        ? dynamodb.BillingMode.PROVISIONED
        : dynamodb.BillingMode.PAY_PER_REQUEST, // Default to on-demand
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI1 with merchantId as partition key
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: {
        name: 'paymentMethod',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI2SK',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI2 for settlement lookups
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: {
        name: 'uniqueId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    if (enableProvisioning) {
      // Enable Auto Scaling for Read Capacity
      const readScaling = this.table.autoScaleReadCapacity({
        minCapacity: 2,
        maxCapacity: 10,
      });
      readScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
      });

      // Enable Auto Scaling for Write Capacity
      const writeScaling = this.table.autoScaleWriteCapacity({
        minCapacity: 2,
        maxCapacity: 10,
      });
      writeScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
      });

      new cdk.CfnOutput(this, 'DynamoDBProvisioningEnabled', { value: 'true' });
    } else {
      new cdk.CfnOutput(this, 'DynamoDBProvisioningEnabled', {
        value: 'false',
      });
    }
  }

  public grantReadWrite(grantee: cdk.aws_iam.IGrantable): void {
    this.table.grantReadWriteData(grantee);
  }

  public grantRead(grantee: cdk.aws_iam.IGrantable): void {
    this.table.grantReadData(grantee);
  }
}
