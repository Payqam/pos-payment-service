import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './index';
import { PaymentServiceVPC } from './vpc';
import { PaymentServiceSecurityGroups } from './security-groups';
import { PaymentServiceIAM } from './iam';
import { PaymentServiceWAF } from './waf';
import { PaymentServiceSNS } from './sns';
import getLogger from '../src/internal/logger';
import { ApiGatewayConstruct, ResourceConfig } from './apigateway';
import { PAYQAMLambda } from './lambda';
import { PATHS } from '../configurations/paths';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Environment } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { createLambdaLogGroup } from './log-groups';

const logger = getLogger();

interface CDKStackProps extends cdk.StackProps {
  envName: string;
  namespace: string;
  envConfigs: EnvConfig;
}

export class CDKStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CDKStackProps) {
    super(scope, id, props);
    const env: Environment = props.env as Environment;

    // Create VPC
    const vpcConstruct = new PaymentServiceVPC(this, 'VPC');

    // Create Security Groups
    const securityGroups = new PaymentServiceSecurityGroups(
      this,
      'SecurityGroups',
      {
        vpc: vpcConstruct.vpc,
      }
    );

    // Create IAM Roles
    const iamConstruct = new PaymentServiceIAM(this, 'IAM', env);

    // Create WAF
    const wafConstruct = new PaymentServiceWAF(this, 'WAF');

    // Log the role ARN and security groups to ensure it's being used (addresses unused constant warning)
    logger.info('Lambda execution role created', {
      roleArn: iamConstruct.lambdaRole.roleArn,
    });
    logger.info('Security groups created', {
      lambdaSecurityGroupId: securityGroups.lambdaSecurityGroup.securityGroupId,
      apiGatewaySecurityGroupId:
        securityGroups.apiGatewaySecurityGroup.securityGroupId,
    });

    const transactionsProcessLambda = new PAYQAMLambda(
      this,
      'TransactionsProcessLambda',
      {
        name: `TransactionsProcess-${props.envName}${props.namespace}`,
        path: `${PATHS.FUNCTIONS.TRANSACTIONS_PROCESS}/handler.ts`,
        vpc: vpcConstruct.vpc,
        environment: {
          LOG_LEVEL: props.envConfigs.LOG_LEVEL,
        },
      }
    );
    logger.info('transactions process lambda created', {
      lambdaArn: transactionsProcessLambda.lambda.functionArn,
    });
    transactionsProcessLambda.lambda.addToRolePolicy(
      iamConstruct.dynamoDBPolicy
    );
    transactionsProcessLambda.lambda.addToRolePolicy(iamConstruct.snsPolicy);

    createLambdaLogGroup(this, transactionsProcessLambda.lambda);

    // Create Salesforce sync Lambda
    const salesforceSyncLambda = new PAYQAMLambda(
      this,
      'SalesforceSyncLambda',
      {
        name: `SalesforceSync${props.envName}${props.namespace}`,
        path: `${PATHS.FUNCTIONS.SALESFORCE_SYNC}/handler.ts`,
        vpc: vpcConstruct.vpc,
        environment: {
          LOG_LEVEL: props.envConfigs.LOG_LEVEL,
          SALESFORCE_SECRET_ARN: `arn:aws:secretsmanager:${env.region}:${env.account}:secret:PayQAM/Salesforce-${props.envName}`,
        },
      }
    );

    // Add required policies to Salesforce sync Lambda
    salesforceSyncLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );
    salesforceSyncLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);

    // Create Stripe webhook Lambda
    const stripeWebhookLambda = new PAYQAMLambda(this, 'StripeWebhookLambda', {
      name: `StripeWebhook${props.envName}${props.namespace}`,
      path: `${PATHS.FUNCTIONS.STRIPE_WEBHOOK}/handler.ts`,
      vpc: vpcConstruct.vpc,
      environment: {
        LOG_LEVEL: props.envConfigs.LOG_LEVEL,
        STRIPE_SECRET_ARN: `arn:aws:secretsmanager:${env.region}:${env.account}:secret:PayQAM/Stripe-${props.envName}`,
      },
    });

    // Add required policies to Stripe webhook Lambda
    stripeWebhookLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    stripeWebhookLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );
    stripeWebhookLambda.lambda.addToRolePolicy(iamConstruct.snsPolicy);

    // Create SNS topic and DLQ for Salesforce events
    const snsConstruct = new PaymentServiceSNS(this, 'PaymentServiceSNS', {
      salesforceSyncLambda: salesforceSyncLambda.lambda,
      envName: props.envName,
      namespace: props.namespace,
    });

    // Add SNS publish permissions to transaction process Lambda
    transactionsProcessLambda.lambda.addToRolePolicy(
      new PolicyStatement({
        actions: ['sns:Publish'],
        resources: [snsConstruct.eventTopic.topicArn],
      })
    );

    const orangeWebhookLambda = new PAYQAMLambda(this, 'OrangeWebhookLambda', {
      name: `OrangeWebhook-${props.envName}${props.namespace}`,
      path: `${PATHS.FUNCTIONS.WEBHOOK_ORANGE}/handler.ts`,
      vpc: vpcConstruct.vpc,
      environment: {
        LOG_LEVEL: props.envConfigs.LOG_LEVEL,
      },
    });
    orangeWebhookLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    createLambdaLogGroup(this, orangeWebhookLambda.lambda);

    const resources: ResourceConfig[] = [
      {
        path: 'process-payments',
        method: 'POST',
        lambda: transactionsProcessLambda.lambda,
        requestModel: {
          modelName: 'ProcessPaymentsRequestModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              amount: { type: apigateway.JsonSchemaType.NUMBER }, //TODO: Update this according to the actual schema
              currency: { type: apigateway.JsonSchemaType.STRING },
              paymentMethod: { type: apigateway.JsonSchemaType.STRING },
            },
            required: ['amount', 'currency', 'paymentMethod'],
          },
        },
        responseModel: {
          modelName: 'ProcessPaymentsResponseModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              transactionId: { type: apigateway.JsonSchemaType.STRING }, //TODO: Update this according to the actual schema
              status: { type: apigateway.JsonSchemaType.STRING },
            },
          },
        },
      },
      {
        path: 'webhook-orange',
        method: 'POST',
        lambda: orangeWebhookLambda.lambda,
      },
      {
        path: 'transaction-status',
        method: 'GET',
        lambda: transactionsProcessLambda.lambda,
        requestParameters: {
          'method.request.querystring.transactionId': true, //TODO: Update this according to the actual schema
        },
        responseModel: {
          modelName: 'TransactionStatusResponseModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              transactionId: { type: apigateway.JsonSchemaType.STRING },
              status: { type: apigateway.JsonSchemaType.STRING },
            },
          },
        },
      },
      {
        path: 'webhooks/stripe',
        method: 'POST',
        lambda: stripeWebhookLambda.lambda,
        requestModel: {
          modelName: 'StripeWebhookRequestModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              id: { type: apigateway.JsonSchemaType.STRING },
              object: { type: apigateway.JsonSchemaType.STRING },
              api_version: { type: apigateway.JsonSchemaType.STRING },
              created: { type: apigateway.JsonSchemaType.NUMBER },
              data: {
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                  object: { type: apigateway.JsonSchemaType.OBJECT },
                },
              },
              type: { type: apigateway.JsonSchemaType.STRING },
            },
            required: ['id', 'object', 'type', 'data'],
          },
        },
        responseModel: {
          modelName: 'StripeWebhookResponseModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              received: { type: apigateway.JsonSchemaType.BOOLEAN },
            },
          },
        },
      },
    ];

    // Create API Gateway with WAF association
    new ApiGatewayConstruct(this, 'ApiGateway', {
      envName: props.envName,
      namespace: props.namespace,
      resources,
      webAcl: wafConstruct.webAcl,
    });

    // Add stack outputs
    new cdk.CfnOutput(this, 'env', {
      value: `${props.envName}${props.namespace}`,
    });

    new cdk.CfnOutput(this, 'region', {
      value: cdk.Stack.of(this).region,
    });

    new cdk.CfnOutput(this, 'vpcId', {
      value: vpcConstruct.vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'webAclId', {
      value: wafConstruct.webAcl.attrId,
      description: 'WAF Web ACL ID',
    });
  }
}
