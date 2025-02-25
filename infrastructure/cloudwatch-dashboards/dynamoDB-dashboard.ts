import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

interface DynamoDBDashboardProps {
  envName: string;
  namespace: string;
  dynamoTableName: string;
}

export class DynamoDBDashboard extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: DynamoDBDashboardProps) {
    super(scope, id);

    this.dashboard = new cloudwatch.Dashboard(this, 'DynamoDBDashboard', {
      dashboardName: `PAYQAM-DynamoDB-Monitoring-${props.envName}${props.namespace}`,
    });

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `### DynamoDB Metrics\n_Monitoring DynamoDB Read/Write Capacity, Latency, Errors, and Usage_`,
        width: 24,
        height: 1,
      }),
      new cloudwatch.TextWidget({
        markdown: `## DynamoDB Table: ${props.dynamoTableName}`,
        width: 24,
        height: 1,
      }),

      // Read & Write Capacity Units
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Read & Write Capacity',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedReadCapacityUnits',
            dimensionsMap: { TableName: props.dynamoTableName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedWriteCapacityUnits',
            dimensionsMap: { TableName: props.dynamoTableName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),

      // Throttled Requests
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttled Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ReadThrottleEvents',
            dimensionsMap: { TableName: props.dynamoTableName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'WriteThrottleEvents',
            dimensionsMap: { TableName: props.dynamoTableName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),

      // Latency (Read/Write)
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Latency (Read & Write)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: {
              TableName: props.dynamoTableName,
              Operation: 'GetItem',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'GetItem Latency',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: {
              TableName: props.dynamoTableName,
              Operation: 'PutItem',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'PutItem Latency',
          }),
        ],
      }),

      // Item Count & Table Size
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Item Count & Table Size',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'TableItemCount',
            dimensionsMap: { TableName: props.dynamoTableName },
            statistic: 'Maximum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'TableSizeBytes',
            dimensionsMap: { TableName: props.dynamoTableName },
            statistic: 'Maximum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),

      // System Errors
      new cloudwatch.GraphWidget({
        title: 'DynamoDB System Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SystemErrors',
            dimensionsMap: { TableName: props.dynamoTableName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      })
    );
  }
}
