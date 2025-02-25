import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

interface SNSDashboardProps {
  envName: string;
  namespace: string;
  snsTopicName: string;
}

export class SNSDashboard extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: SNSDashboardProps) {
    super(scope, id);

    // Create CloudWatch Dashboard for SNS
    this.dashboard = new cloudwatch.Dashboard(this, 'SNSDashboard', {
      dashboardName: `PAYQAM-SNS-Monitoring-${props.envName}${props.namespace}`,
    });

    // Add a heading for SNS metrics
    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `### SNS Metrics\n_Monitoring SNS Message Count_`,
        width: 24,
        height: 1,
      }),
      new cloudwatch.TextWidget({
        markdown: `## SNS Topic: ${props.snsTopicName}`,
        width: 24,
        height: 1,
      }),
      new cloudwatch.GraphWidget({
        title: 'SNS Message Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/SNS',
            metricName: 'NumberOfMessagesPublished',
            statistic: 'Sum',
            dimensionsMap: { TopicName: props.snsTopicName },
            period: cdk.Duration.minutes(5),
          }),
        ],
      })
    );
  }
}
