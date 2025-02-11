import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './index';
import { PaymentServiceVPC } from './vpc';
import { PaymentServiceSecurityGroups } from './security-groups';
import { PaymentServiceIAM } from './iam';
import { PaymentServiceWAF } from './waf';
import { PaymentServiceSNS } from './sns';
import { ApiGatewayConstruct, ResourceConfig } from './apigateway';
import { PAYQAMLambda } from './lambda';
import { PATHS } from '../configurations/paths';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Environment } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { createLambdaLogGroup } from './log-groups';
import { SecretsManagerHelper } from './secretsmanager';
import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBConstruct } from './dynamodb';
import { ElasticCacheConstruct } from './elasticache';
import { PaymentServiceXRay } from './xray';
import { KMSHelper } from './kms';

const logger: Logger = LoggerService.named('cdk-stack');

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
        envName: props.envName,
        namespace: props.namespace,
      }
    );

    // Create IAM Roles
    const iamConstruct = new PaymentServiceIAM(this, 'IAM', env);

    // Create WAF
    const wafConstruct = new PaymentServiceWAF(this, 'WAF');

    // Create X-Ray configuration
    new PaymentServiceXRay(this, 'XRay', {
      envName: props.envName,
      namespace: props.namespace,
    });

    // Create DynamoDB table
    const dynamoDBConstruct = new DynamoDBConstruct(this, 'DynamoDB', {
      envName: props.envName,
      namespace: props.namespace,
      tableName: `PAYQAM-Transactions-${props.envName}${props.namespace}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Only for development, use RETAIN for production
    });

    // Log the role ARN and security groups to ensure it's being used (addresses unused constant warning)
    logger.info('Lambda execution role created', {
      roleArn: iamConstruct.lambdaRole.roleArn,
    });
    logger.info('Security groups created', {
      lambdaSecurityGroupId: securityGroups.lambdaSecurityGroup.securityGroupId,
      apiGatewaySecurityGroupId:
        securityGroups.apiGatewaySecurityGroup.securityGroupId,
    });

    const stripeConfig = {
      secretName: `STRIPE_API_SECRET-${props.envName}${props.namespace}`,
      description: 'Stores Stripe API keys and endpoint',
      secretValues: {
        apiKey: process.env.STRIPE_API_SECRET as string,
        signingSecret: process.env.STRIPE_SIGNING_SECRET as string,
      },
    };

    // Define secret values for MTN
    const mtnConfig = {
      secretName: `MTN_API_SECRET-${props.envName}${props.namespace}`,
      description: 'Stores MTN Mobile Money API keys and endpoint',
      secretValues: {
        endpoint: 'https://api.mtn.com',
        apiKey: 'mtn_test_your_key_here',
      },
    };

    // Define secret values for Orange
    const orangeConfig = {
      secretName: `ORANGE_API_SECRET-${props.envName}${props.namespace}`,
      description: 'Stores Orange Money API keys and endpoint',
      secretValues: {
        endpoint: 'https://api.orange.com',
        apiKey: 'orange_test_your_key_here',
      },
    };

    // Define configs for KMS
    const kmsConfig = {
      keyName: `KMS-${props.envName}${props.namespace}`,
      description: 'Stores KMS keys',
      accountId: env.account,
      stage: props.envName,
      serviceName: 'PaymentService',
      externalRoleArns: [iamConstruct.lambdaRole.roleArn],
      enableKeyRotation: true,
      enabled: true,
      rotationPeriod: 365,
    };

    // Create secrets using the helper
    const stripeSecret = SecretsManagerHelper.createSecret(this, stripeConfig);
    const mtnSecret = SecretsManagerHelper.createSecret(this, mtnConfig);
    const orangeSecret = SecretsManagerHelper.createSecret(this, orangeConfig);

    // Create KMS key
    const { key: stripeKMSKey, alias: stripeAlias } =
      KMSHelper.createKey(this, kmsConfig);


    // Create ElastiCache cluster
    const cache = new ElasticCacheConstruct(this, 'Cache', {
      envName: props.envName,
      namespace: props.namespace,
      vpc: vpcConstruct.vpc,
      securityGroup: securityGroups.cacheSecurityGroup,
    });

    const transactionsProcessLambda = new PAYQAMLambda(
      this,
      'TransactionsProcessLambda',
      {
        name: `TransactionsProcess-${props.envName}${props.namespace}`,
        path: `${PATHS.FUNCTIONS.TRANSACTIONS_PROCESS}/handler.ts`,
        vpc: vpcConstruct.vpc,
        securityGroup: securityGroups.lambdaSecurityGroup,
        environment: {
          LOG_LEVEL: props.envConfigs.LOG_LEVEL,
          STRIPE_API_SECRET: stripeSecret.secretName,
          MTN_API_SECRET: mtnSecret.secretName,
          ORANGE_API_SECRET: orangeSecret.secretName,
          TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
          VALKEY_PRIMARY_ENDPOINT: cache.cluster.attrPrimaryEndPointAddress,
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
    transactionsProcessLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );

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
        STRIPE_API_SECRET: stripeSecret.secretName,
        TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
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

    // Create Orange webhook Lambda
    const orangeWebhookLambda = new PAYQAMLambda(this, 'OrangeWebhookLambda', {
      name: `OrangeWebhook-${props.envName}${props.namespace}`,
      path: `${PATHS.FUNCTIONS.ORANGE_WEBHOOK}/handler.ts`,
      vpc: vpcConstruct.vpc,
      environment: {
        LOG_LEVEL: props.envConfigs.LOG_LEVEL,
      },
    });
    orangeWebhookLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    createLambdaLogGroup(this, orangeWebhookLambda.lambda);

    // Create MTN webhook Lambda
    const mtnWebhookLambda = new PAYQAMLambda(this, 'MTNWebhookLambda', {
      name: `MTNWebhook-${props.envName}${props.namespace}`,
      path: `${PATHS.FUNCTIONS.MTN_WEBHOOK}/handler.ts`,
      vpc: vpcConstruct.vpc,
      environment: {
        LOG_LEVEL: props.envConfigs.LOG_LEVEL,
      },
    });
    mtnWebhookLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    createLambdaLogGroup(this, mtnWebhookLambda.lambda);

    // Grant DynamoDB permissions to Lambda functions
    dynamoDBConstruct.grantReadWrite(transactionsProcessLambda.lambda);
    dynamoDBConstruct.grantReadWrite(transactionsProcessLambda.lambda);
    dynamoDBConstruct.grantReadWrite(stripeWebhookLambda.lambda);
    dynamoDBConstruct.grantReadWrite(orangeWebhookLambda.lambda);
    dynamoDBConstruct.grantReadWrite(mtnWebhookLambda.lambda);

    const resources: ResourceConfig[] = [
      {
        path: 'process-payments',
        method: 'POST',
        lambda: transactionsProcessLambda.lambda,
        apiKeyRequired: true,
        requestModel: {
          modelName: 'ProcessPaymentsRequestModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              merchantId: { type: apigateway.JsonSchemaType.STRING },
              amount: { type: apigateway.JsonSchemaType.NUMBER },
              customerPhone: { type: apigateway.JsonSchemaType.STRING },
              transactionType: { type: apigateway.JsonSchemaType.STRING },
              paymentMethod: { type: apigateway.JsonSchemaType.STRING },
              metaData: { type: apigateway.JsonSchemaType.OBJECT },
              cardData: { type: apigateway.JsonSchemaType.OBJECT },
            },
            required: [
              'merchantId',
              'amount',
              'customerPhone',
              'transactionType',
              'paymentMethod',
              'metaData',
            ],
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
        apiKeyRequired: true,
      },
      {
        path: 'transaction-status',
        method: 'GET',
        lambda: transactionsProcessLambda.lambda,
        apiKeyRequired: true,
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
        apiKeyRequired: false,
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

    new cdk.CfnOutput(this, 'wafAclId', {
      value: wafConstruct.webAcl.attrId,
      description: 'WAF Web ACL ID',
    });

    new cdk.CfnOutput(this, 'elastiCacheCluster', {
      value: cache.cluster.ref,
      description: 'ElastiCache Cluster Name',
    });
  }
}
