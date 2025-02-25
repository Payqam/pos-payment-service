import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

interface ApiGatewayDashboardProps {
  envName: string;
  namespace: string;
  apiGatewayName: string;
}

export class ApiGatewayDashboard extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ApiGatewayDashboardProps) {
    super(scope, id);

    this.dashboard = new cloudwatch.Dashboard(this, 'ApiGatewayDashboard', {
      dashboardName: `PAYQAM-APIGateway-Monitoring-${props.envName}${props.namespace}`,
    });

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `### API Gateway Metrics\n_Monitoring API request count, latency, and errors_`,
        width: 24,
        height: 1,
      }),
      new cloudwatch.TextWidget({
        markdown: `## API Gateway: ${props.apiGatewayName}`,
        width: 24,
        height: 1,
      }),

      // Request Count
      new cloudwatch.GraphWidget({
        title: 'API Gateway Request Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),

      // Latency Metrics
      new cloudwatch.GraphWidget({
        title: 'API Gateway Latency (P50, P90, P99)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'p50',
            period: cdk.Duration.minutes(5),
            label: 'P50 Latency',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'p90',
            period: cdk.Duration.minutes(5),
            label: 'P90 Latency',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
            label: 'P99 Latency',
          }),
        ],
      }),

      // 4XX & 5XX Errors
      new cloudwatch.GraphWidget({
        title: 'API Gateway 4XX & 5XX Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4xx',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5xx',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),

      // Integration Errors
      new cloudwatch.GraphWidget({
        title: 'API Gateway Integration Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'IntegrationLatency',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'IntegrationLatency',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),

      // Cache Hits & Misses
      new cloudwatch.GraphWidget({
        title: 'API Gateway Cache Hits & Misses',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'CacheHitCount',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'CacheMissCount',
            dimensionsMap: { ApiName: props.apiGatewayName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      })
    );
  }
}
