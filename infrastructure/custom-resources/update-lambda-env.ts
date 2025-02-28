import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface UpdateLambdaEnvProps {
  lambda: lambda.IFunction;
  apiGateway: cdk.aws_apigateway.RestApi;
  stage: string;
  envName: string;
  currentEnvVars: { [key: string]: string }; // Add this to pass current env vars
  newEnvVars: { [key: string]: string }; // Add this to pass new env vars
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
              ...props.currentEnvVars, // Use passed environment variables
              ...(props.newEnvVars.MTN_PAYMENT_WEBHOOK_URL
                ? {
                    MTN_PAYMENT_WEBHOOK_URL: `https://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/${props.newEnvVars.MTN_PAYMENT_WEBHOOK_URL}`,
                  }
                : {}),
              ...(props.newEnvVars.MTN_PAYMENT_WEBHOOK_URL
                ? {
                    MTN_DISBURSEMENT_WEBHOOK_URL: `https://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/${props.newEnvVars.MTN_DISBURSEMENT_WEBHOOK_URL}`,
                  }
                : {}),
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
