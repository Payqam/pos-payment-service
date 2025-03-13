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
  currentEnvVars: { [key: string]: string };
  newEnvVars: { [key: string]: string };
}

export class UpdateLambdaEnv extends Construct {
  constructor(scope: Construct, id: string, props: UpdateLambdaEnvProps) {
    super(scope, id);

    // Debug logs for webhook URLs
    console.log('[DEBUG] UpdateLambdaEnv - Input webhook URLs:', {
      MTN_PAYMENT_WEBHOOK_URL: props.newEnvVars.MTN_PAYMENT_WEBHOOK_URL,
      MTN_DISBURSEMENT_WEBHOOK_URL:
        props.newEnvVars.MTN_DISBURSEMENT_WEBHOOK_URL,
      MTN_CUSTOMER_REFUND_WEBHOOK_URL:
        props.newEnvVars.MTN_CUSTOMER_REFUND_WEBHOOK_URL,
      MTN_MERCHANT_REFUND_WEBHOOK_URL:
        props.newEnvVars.MTN_MERCHANT_REFUND_WEBHOOK_URL,
    });

    // Prepare the environment variables with full URLs
    const mtnPaymentWebhookUrl = props.newEnvVars.MTN_PAYMENT_WEBHOOK_URL
      ? `https://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/${props.newEnvVars.MTN_PAYMENT_WEBHOOK_URL}`
      : undefined;

    const mtnDisbursementWebhookUrl = props.newEnvVars
      .MTN_DISBURSEMENT_WEBHOOK_URL
      ? `https://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/${props.newEnvVars.MTN_DISBURSEMENT_WEBHOOK_URL}`
      : undefined;

    const mtnCustomerRefundWebhookUrl = props.newEnvVars
      .MTN_CUSTOMER_REFUND_WEBHOOK_URL
      ? `https://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/${props.newEnvVars.MTN_CUSTOMER_REFUND_WEBHOOK_URL}`
      : undefined;

    const mtnMerchantRefundWebhookUrl = props.newEnvVars
      .MTN_MERCHANT_REFUND_WEBHOOK_URL
      ? `https://${props.apiGateway.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${props.envName}/${props.newEnvVars.MTN_MERCHANT_REFUND_WEBHOOK_URL}`
      : undefined;

    // Debug logs for constructed full URLs
    console.log('[DEBUG] UpdateLambdaEnv - Constructed full webhook URLs:', {
      MTN_PAYMENT_WEBHOOK_URL: mtnPaymentWebhookUrl,
      MTN_DISBURSEMENT_WEBHOOK_URL: mtnDisbursementWebhookUrl,
      MTN_CUSTOMER_REFUND_WEBHOOK_URL: mtnCustomerRefundWebhookUrl,
      MTN_MERCHANT_REFUND_WEBHOOK_URL: mtnMerchantRefundWebhookUrl,
    });

    // Create environment variables object with all the required variables
    const environmentVariables = {
      ...props.currentEnvVars,
      ...(mtnPaymentWebhookUrl
        ? { MTN_PAYMENT_WEBHOOK_URL: mtnPaymentWebhookUrl }
        : {}),
      ...(mtnDisbursementWebhookUrl
        ? { MTN_DISBURSEMENT_WEBHOOK_URL: mtnDisbursementWebhookUrl }
        : {}),
      ...(mtnCustomerRefundWebhookUrl
        ? { MTN_CUSTOMER_REFUND_WEBHOOK_URL: mtnCustomerRefundWebhookUrl }
        : {}),
      ...(mtnMerchantRefundWebhookUrl
        ? { MTN_MERCHANT_REFUND_WEBHOOK_URL: mtnMerchantRefundWebhookUrl }
        : {}),
    };

    // Debug log for final environment variables
    console.log(
      '[DEBUG] UpdateLambdaEnv - Final environment variables:',
      environmentVariables
    );

    // Create Custom Resource
    new cr.AwsCustomResource(this, 'UpdateWebhookUrl', {
      onCreate: {
        service: 'Lambda',
        action: 'updateFunctionConfiguration',
        parameters: {
          FunctionName: props.lambda.functionName,
          Environment: {
            Variables: environmentVariables,
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of('WebhookUrlUpdate'),
      },
      onUpdate: {
        service: 'Lambda',
        action: 'updateFunctionConfiguration',
        parameters: {
          FunctionName: props.lambda.functionName,
          Environment: {
            Variables: environmentVariables,
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
