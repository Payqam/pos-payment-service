import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

interface LambdaDashboardProps {
  envName: string;
  namespace: string;
  lambdaFunctionNames: string[];
}

export class LambdaDashboard extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: LambdaDashboardProps) {
    super(scope, id);

    // Create CloudWatch Dashboard for Lambda
    this.dashboard = new cloudwatch.Dashboard(this, 'LambdaDashboard', {
      dashboardName: `PAYQAM-Lambda-Monitoring-${props.envName}${props.namespace}`,
    });

    props.lambdaFunctionNames.forEach((lambdaName) => {
      this.dashboard.addWidgets(
        new cloudwatch.TextWidget({
          markdown: `### ${lambdaName}`,
          width: 24,
          height: 1,
        })
      );
      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `Lambda Invocations - ${lambdaName}`,
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Invocations',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: `Lambda Error Count & success rate (%) - ${lambdaName}`,
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Errors',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Success rate(%)',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: `Lambda Duration - ${lambdaName}`,
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Duration minimum',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Duration average',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Duration maximum',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: `Lambda Throttles - ${lambdaName}`,
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Throttles',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: `Lambda Total concurrent executions - ${lambdaName}`,
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Lambda ConcurrentExecutions',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: `Lambda Recursive invocations dropped - ${lambdaName}`,
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Recursive invocations dropped',
              statistic: 'Sum',
              dimensionsMap: { FunctionName: lambdaName },
              period: cdk.Duration.minutes(5),
            }),
          ],
        }),
        new cloudwatch.LogQueryWidget({
          title: `Lambda Error Logs - ${lambdaName}`,
          logGroupNames: [`/aws/lambda/${lambdaName}`],
          width: 24,
          height: 6,
          queryString: `
            fields @timestamp, @message
            | filter @message like /ERROR/
            | sort @timestamp desc
            | limit 20
          `,
        }),
        new cloudwatch.LogQueryWidget({
          title: `Lambda Recent Executions - ${lambdaName}`,
          logGroupNames: [`/aws/lambda/${lambdaName}`],
          width: 24,
          height: 6,
          queryString: `
            fields @timestamp, @message, requestId
            | sort @timestamp desc
            | limit 20
          `,
        })
      );
    });
  }
}
