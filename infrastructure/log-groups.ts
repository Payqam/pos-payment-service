import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

export function createLambdaLogGroup(
  scope: Construct,
  lambdaFunction: IFunction,
  retentionDays: logs.RetentionDays = logs.RetentionDays.ONE_WEEK
) {
  new logs.LogGroup(scope, `${lambdaFunction.node.id}LogGroup`, {
    logGroupName: `/aws/lambda/${lambdaFunction.functionName}`,
    retention: retentionDays,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
}
