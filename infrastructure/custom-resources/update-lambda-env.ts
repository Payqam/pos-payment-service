import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface UpdateLambdaEnvProps {
  lambda: lambda.IFunction;
  apiGateway: cdk.aws_apigateway.RestApi;
  envName: string;
  currentEnvVars: { [key: string]: string };
}

export class UpdateLambdaEnv extends Construct {
  constructor(scope: Construct, id: string, props: UpdateLambdaEnvProps) {
    super(scope, id);

    // Create Custom Resource
    new cr.AwsCustomResource(this, 'UpdateWebhookUrl', {
      onCreate: {
        service: 'Lambda',
        action: 'updateFunctionConfiguration',
        parameters: {
          FunctionName: props.lambda.functionName,
          Environment: {
            Variables: {
              ...props.currentEnvVars,
              MTN_WEBHOOK_URL:
                process.env.MTN_TARGET_ENVIRONMENT === 'sandbox'
                  ? `http://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/webhook/mtn`
                  : `https://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/webhook/mtn`,
            },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of('WebhookUrlUpdate'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['lambda:UpdateFunctionConfiguration'],
          resources: [props.lambda.functionArn],
        }),
      ]),
    });
  }
}
