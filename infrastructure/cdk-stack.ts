import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
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
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { UpdateLambdaEnv } from './custom-resources/update-lambda-env';
import { KMSHelper } from './kms';
import * as kms from 'aws-cdk-lib/aws-kms';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-logs-destinations';
import * as logs from 'aws-cdk-lib/aws-logs';
import { LambdaDashboard } from './cloudwatch-dashboards/lambda-dashboard';
import { DynamoDBDashboard } from './cloudwatch-dashboards/dynamoDB-dashboard';
import { SNSDashboard } from './cloudwatch-dashboards/sns-dashboard';
import { ApiGatewayDashboard } from './cloudwatch-dashboards/apiGateway-dashboard';

const logger: Logger = LoggerService.named('cdk-stack');

interface CDKStackProps extends cdk.StackProps {
  envName: string;
  namespace: string;
  envConfigs: EnvConfig;
  slackWebhookUrl: string;
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

    const salesForceConfig = {
      secretName: `SALESFORCE_SECRET-${props.envName}${props.namespace}`,
      description: 'Stores Salesforce API Secrets and endpoint',
      secretValues: {
        clientId: process.env.SALESFORCE_CLIENT_ID as string,
        clientSecret: process.env.SALESFORCE_CLIENT_SECRET as string,
      },
    };

    const stripeConfig = {
      secretName: `STRIPE_API_SECRET-${props.envName}${props.namespace}`,
      description: 'Stores Stripe API keys and endpoint',
      secretValues: {
        apiKey: process.env.STRIPE_API_SECRET || 'stripe_test_key',
        signingSecret:
          process.env.STRIPE_SIGNING_SECRET || 'stripe_test_signing_secret',
      },
    };

    // Define secret values for MTN
    const mtnConfig = {
      secretName: `MTN_API_SECRET-${props.envName}${props.namespace}`,
      description: 'Stores MTN Mobile Money API keys and endpoint',
      secretValues: {
        collection: {
          subscriptionKey:
            process.env.MTN_COLLECTION_SUBSCRIPTION_KEY ||
            'mtn_test_collection_key',
          apiUser:
            process.env.MTN_COLLECTION_API_USER || 'mtn_test_collection_user',
          apiKey:
            process.env.MTN_COLLECTION_API_KEY || 'mtn_test_collection_api_key',
        },
        disbursement: {
          subscriptionKey:
            process.env.MTN_DISBURSEMENT_SUBSCRIPTION_KEY ||
            'mtn_test_disbursement_key',
          apiUser:
            process.env.MTN_DISBURSEMENT_API_USER ||
            'mtn_test_disbursement_user',
          apiKey:
            process.env.MTN_DISBURSEMENT_API_KEY ||
            'mtn_test_disbursement_api_key',
        },
        targetEnvironment: process.env.MTN_TARGET_ENVIRONMENT || 'sandbox',
      },
    };

    // Define secret values for Orange
    const orangeConfig = {
      secretName: `ORANGE_API_SECRET-${props.envName}${props.namespace}`,
      description: 'Stores Orange Money API keys and endpoint',
      secretValues: {
        baseUrl: process.env.ORANGE_API_BASE_URL || '',
        tokenUrl: process.env.ORANGE_API_TOKEN_URL || '',
        clientId: process.env.ORANGE_CLIENT_ID || '',
        xAuthToken: process.env.ORANGE_X_AUTH_TOKEN || '',
        notifyUrl: process.env.ORANGE_NOTIFY_URL || '',
        merchantPhone: process.env.ORANGE_PAYQAM_MERCHANT_PHONE || '',
        merchantPin: process.env.ORANGE_PAYQAM_PIN || '',
      },
    };

    // Create secrets using the helper
    const stripeSecret = SecretsManagerHelper.createSecret(this, stripeConfig);
    const mtnSecret = SecretsManagerHelper.createSecret(this, mtnConfig);
    const orangeSecret = SecretsManagerHelper.createSecret(this, orangeConfig);
    const salesForceSecret = SecretsManagerHelper.createSecret(
      this,
      salesForceConfig
    );

    // Create ElastiCache cluster if enabled
    let cacheEndpoint: string | undefined;
    const enableCache = process.env.ENABLE_CACHE === 'true';

    if (enableCache) {
      const cache = new ElasticCacheConstruct(this, 'Cache', {
        envName: props.envName,
        namespace: props.namespace,
        vpc: vpcConstruct.vpc,
        securityGroup: securityGroups.cacheSecurityGroup,
      });
      cacheEndpoint = cache.cluster.attrPrimaryEndPointAddress;
    }

    // Check for existing KMS key ARN in environment variables
    let key: kms.Key;
    const existingKeyArn = process.env.KMS_KEY_ARN;

    if (existingKeyArn) {
      // Use fromKeyArn to reference the existing key
      key = kms.Key.fromKeyArn(
        this,
        'ExistingTransactionsKey',
        existingKeyArn
      ) as kms.Key;
    } else {
      // Create new key if no existing ARN found
      const { key: newKey } = KMSHelper.createKey(this, {
        keyName: 'TransactionsEncryption',
        description: 'KMS Key for Transactions Processing',
        accountId: env.account as string,
        stage: props.envName,
        namespace: props.namespace,
        serviceName: 'transactions-transport',
        externalRoleArns: [],
        iamUserArn: 'arn:aws:iam::061051235502:user/kms-decrypt', //todo: update this with correct ARN
        region: env.region as string,
      });
      key = newKey;
    }

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
          SALESFORCE_SECRET: salesForceSecret.secretName,
          SALESFORCE_URL_HOST: process.env.SALESFORCE_URL_HOST as string,
          SALESFORCE_OWNER_ID: process.env.SALESFORCE_OWNER_ID as string,
        },
      }
    );

    // Add required policies to Salesforce sync Lambda
    salesforceSyncLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );
    salesforceSyncLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);

    // Create SNS topic and DLQ for Salesforce events
    const snsConstruct = new PaymentServiceSNS(this, 'PaymentServiceSNS', {
      salesforceSyncLambda: salesforceSyncLambda.lambda,
      envName: props.envName,
      namespace: props.namespace,
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
          MTN_TARGET_ENVIRONMENT: process.env.MTN_TARGET_ENVIRONMENT as string,
          MTN_API_SECRET: mtnSecret.secretName,
          ORANGE_API_SECRET: orangeSecret.secretName,
          TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
          PAYQAM_FEE_PERCENTAGE: process.env.PAYQAM_FEE_PERCENTAGE as string,
          ENABLE_CACHE: enableCache ? 'true' : 'false',
          VALKEY_PRIMARY_ENDPOINT: cacheEndpoint || '',
          TRANSACTION_STATUS_TOPIC_ARN: snsConstruct.eventTopic.topicArn,
          KMS_TRANSPORT_KEY: key.keyArn,
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
    transactionsProcessLambda.lambda.addToRolePolicy(
      new PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [orangeSecret.secretArn],
      })
    );
    // Define configs for KMS
    key.grantDecrypt(transactionsProcessLambda.lambda);
    KMSHelper.grantDecryptPermission(
      key,
      transactionsProcessLambda.lambda,
      env.region as string,
      env.account as string
    );

    createLambdaLogGroup(this, transactionsProcessLambda.lambda);

    // Add SNS publish permissions to transaction process Lambda
    transactionsProcessLambda.lambda.addToRolePolicy(
      new PolicyStatement({
        actions: ['sns:Publish'],
        resources: [snsConstruct.eventTopic.topicArn],
      })
    );

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
        TRANSACTION_STATUS_TOPIC_ARN: snsConstruct.eventTopic.topicArn,
      },
    });

    // Add required policies to Stripe webhook Lambda
    stripeWebhookLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    stripeWebhookLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );
    stripeWebhookLambda.lambda.addToRolePolicy(iamConstruct.snsPolicy);
    createLambdaLogGroup(this, stripeWebhookLambda.lambda);
    
    // Create Orange webhook Lambda
    const orangeWebhookLambda = new PAYQAMLambda(this, 'OrangeWebhookLambda', {
      name: `OrangeWebhook-${props.envName}${props.namespace}`,
      path: `${PATHS.FUNCTIONS.ORANGE_WEBHOOK}/handler.ts`,
      vpc: vpcConstruct.vpc,
      environment: {
        LOG_LEVEL: props.envConfigs.LOG_LEVEL,
        TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
        TRANSACTION_STATUS_TOPIC_ARN: snsConstruct.eventTopic.topicArn,
        ORANGE_API_SECRET: orangeSecret.secretName,
      },
    });
    orangeWebhookLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    orangeWebhookLambda.lambda.addToRolePolicy(iamConstruct.snsPolicy);
    orangeWebhookLambda.lambda.addToRolePolicy(iamConstruct.secretsManagerPolicy);
    orangeSecret.grantRead(orangeWebhookLambda.lambda);
    createLambdaLogGroup(this, orangeWebhookLambda.lambda);

    // Add secrets policy to transactions process Lambda
    orangeSecret.grantRead(transactionsProcessLambda.lambda);

    // Create MTN payment webhook Lambda
    const mtnPaymentWebhookLambda = new PAYQAMLambda(
      this,
      'MTNPaymentWebhookLambda',
      {
        name: `MTNWebhook-payment-${props.envName}${props.namespace}`,
        path: `${PATHS.FUNCTIONS.MTN_PAYMENT_WEBHOOK}/handler.ts`,
        vpc: vpcConstruct.vpc,
        environment: {
          LOG_LEVEL: props.envConfigs.LOG_LEVEL,
          MTN_TARGET_ENVIRONMENT: process.env.MTN_TARGET_ENVIRONMENT as string,
          MTN_API_SECRET: mtnSecret.secretName,
          TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
          TRANSACTION_STATUS_TOPIC_ARN: snsConstruct.eventTopic.topicArn,
          INSTANT_DISBURSEMENT_ENABLED: 'true', // Enable instant disbursement by default
          PAYQAM_FEE_PERCENTAGE: '2.5', // PayQAM takes 2.5% of each transaction
          MTN_PAYMENT_WEBHOOK_URL:
            process.env.MTN_PAYMENT_WEBHOOK_URL ||
            'https://wnbazhdk29.execute-api.us-east-1.amazonaws.com//DEV/webhooks/mtn/payment',
          MTN_DISBURSEMENT_WEBHOOK_URL:
            process.env.MTN_DISBURSEMENT_WEBHOOK_URL ||
            'https://wnbazhdk29.execute-api.us-east-1.amazonaws.com/DEV/webhooks/mtn/disbursement', // Sample webhook
        },
      }
    );
    mtnPaymentWebhookLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    mtnPaymentWebhookLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );
    mtnPaymentWebhookLambda.lambda.addToRolePolicy(iamConstruct.snsPolicy);
    createLambdaLogGroup(this, mtnPaymentWebhookLambda.lambda);

    // Create MTN disbursement webhook Lambda
    const mtnDisbursementWebhookLambda = new PAYQAMLambda(
      this,
      'MTNDisbursementWebhookLambda',
      {
        name: `MTNWebhook-disbursement-${props.envName}${props.namespace}`,
        path: `${PATHS.FUNCTIONS.MTN_DISBURSEMENT_WEBHOOK}/handler.ts`,
        vpc: vpcConstruct.vpc,
        environment: {
          LOG_LEVEL: props.envConfigs.LOG_LEVEL,
          MTN_API_SECRET: mtnSecret.secretName,
          TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
          TRANSACTION_STATUS_TOPIC_ARN: snsConstruct.eventTopic.topicArn,
        },
      }
    );
    mtnDisbursementWebhookLambda.lambda.addToRolePolicy(
      iamConstruct.dynamoDBPolicy
    );
    mtnDisbursementWebhookLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );
    mtnDisbursementWebhookLambda.lambda.addToRolePolicy(iamConstruct.snsPolicy);
    createLambdaLogGroup(this, mtnDisbursementWebhookLambda.lambda);

    // Create Daily Disbursement Lambda with configurable execution time
    const disbursementLambda = new PAYQAMLambda(this, 'DisbursementLambda', {
      name: `Disbursement-${props.envName}${props.namespace}`,
      path: `${PATHS.FUNCTIONS.DISBURSEMENT}/handler.ts`,
      vpc: vpcConstruct.vpc,
      environment: {
        LOG_LEVEL: props.envConfigs.LOG_LEVEL,
        MTN_API_SECRET: mtnSecret.secretName,
        TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
      },
    });
    disbursementLambda.lambda.addToRolePolicy(iamConstruct.dynamoDBPolicy);
    disbursementLambda.lambda.addToRolePolicy(
      iamConstruct.secretsManagerPolicy
    );
    disbursementLambda.lambda.addToRolePolicy(iamConstruct.snsPolicy);
    createLambdaLogGroup(this, disbursementLambda.lambda);

    // Create CloudWatch Event Rule to trigger disbursement lambda at configured time
    /**
     * Time to run daily disbursement in "HH:mm" format (24-hour)
     * Examples:
     * - "02:00" for 2 AM
     * - "14:30" for 2:30 PM
     * - "23:45" for 11:45 PM
     */
    const disbursementTime = process.env.DISBURSEMENT_TIME;
    new events.Rule(this, 'DisbursementSchedule', {
      description:
        'Triggers the daily disbursement process at the configured time',
      schedule: events.Schedule.cron({
        minute: disbursementTime?.split(':')[1] || '0',
        hour: disbursementTime?.split(':')[0] || '2',
        day: '*',
        month: '*',
        year: '*',
      }),
      targets: [new targets.LambdaFunction(disbursementLambda.lambda)],
    });

    // Grant DynamoDB permissions to Lambda functions
    dynamoDBConstruct.grantReadWrite(transactionsProcessLambda.lambda);
    dynamoDBConstruct.grantReadWrite(transactionsProcessLambda.lambda);
    dynamoDBConstruct.grantReadWrite(stripeWebhookLambda.lambda);
    dynamoDBConstruct.grantReadWrite(orangeWebhookLambda.lambda);
    dynamoDBConstruct.grantReadWrite(mtnPaymentWebhookLambda.lambda);
    dynamoDBConstruct.grantReadWrite(mtnDisbursementWebhookLambda.lambda);
    dynamoDBConstruct.grantReadWrite(disbursementLambda.lambda);
    // Grant SNS permissions to MTN webhook lambdas
    snsConstruct.eventTopic.grantPublish(mtnPaymentWebhookLambda.lambda);
    snsConstruct.eventTopic.grantPublish(mtnDisbursementWebhookLambda.lambda);

    const slackNotifierLambda = new PAYQAMLambda(this, 'SlackNotifierLambda', {
      name: `SlackNotifier-${props.envName}${props.namespace}`,
      path: `${PATHS.FUNCTIONS.SLACK_NOTIFIER}/handler.ts`,
      vpc: vpcConstruct.vpc,
      environment: {
        LOG_LEVEL: props.envConfigs.LOG_LEVEL,
        SLACK_WEBHOOK_URL: props.slackWebhookUrl,
      },
    });

    const monitoredLambdas = [
      mtnPaymentWebhookLambda.lambda,
      mtnDisbursementWebhookLambda.lambda,
      stripeWebhookLambda.lambda,
      transactionsProcessLambda.lambda,
      orangeWebhookLambda.lambda,
    ];
    monitoredLambdas.forEach((logGroupName: IFunction) => {
      const subscriptionFilter = new logs.SubscriptionFilter(
        this,
        `Subscription-${logGroupName}`,
        {
          logGroup: logs.LogGroup.fromLogGroupName(
            this,
            `LogGroup-${logGroupName}`,
            `/aws/lambda/${logGroupName.functionName}`
          ),
          destination: new destinations.LambdaDestination(
            slackNotifierLambda.lambda
          ),
          filterPattern: logs.FilterPattern.anyTerm(
            'ERROR',
            'MainThread',
            'WARN'
          ),
          filterName: `ErrorInMainThread-${logGroupName.functionName}`,
        }
      );

      subscriptionFilter.node.addDependency(logGroupName);
    });
    const resources: ResourceConfig[] = [
      {
        path: 'transaction/process/charge',
        method: 'POST',
        lambda: transactionsProcessLambda.lambda,
        apiKeyRequired: true,
        requestModel: {
          modelName: 'ProcessPaymentsChargeRequestModel',
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
          modelName: 'ProcessPaymentsChargeResponseModel',
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
        path: 'transaction/process/refund',
        method: 'POST',
        lambda: transactionsProcessLambda.lambda,
        apiKeyRequired: true,
        requestModel: {
          modelName: 'ProcessPaymentsRefundRequestModel',
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
          modelName: 'ProcessPaymentsRefundResponseModel',
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
        path: 'transaction/status',
        method: 'GET',
        lambda: transactionsProcessLambda.lambda,
        apiKeyRequired: true,
        requestParameters: {
          'method.request.querystring.transactionId': true,
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
      {
        path: 'webhooks/orange',
        method: 'POST',
        lambda: orangeWebhookLambda.lambda,
        apiKeyRequired: false,
        requestModel: {
          modelName: 'OrangeWebhookRequestModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              type: { type: apigateway.JsonSchemaType.STRING },
              data: {
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                  transactionId: { type: apigateway.JsonSchemaType.STRING },
                  payToken: { type: apigateway.JsonSchemaType.STRING },
                  status: { type: apigateway.JsonSchemaType.STRING },
                  amount: { type: apigateway.JsonSchemaType.STRING },
                  currency: { type: apigateway.JsonSchemaType.STRING },
                },
              },
            },
          },
        },
        responseModel: {
          modelName: 'OrangeWebhookResponseModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              message: { type: apigateway.JsonSchemaType.STRING },
            },
          },
        },
      },
      {
        path: 'webhooks/mtn/payment',
        method: 'POST',
        lambda: mtnPaymentWebhookLambda.lambda,
        apiKeyRequired: false,
        requestModel: {
          modelName: 'MTNPaymentWebhookRequestModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              type: { type: apigateway.JsonSchemaType.STRING },
              data: {
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                  transactionId: { type: apigateway.JsonSchemaType.STRING },
                  status: { type: apigateway.JsonSchemaType.STRING },
                  reason: { type: apigateway.JsonSchemaType.STRING },
                  amount: { type: apigateway.JsonSchemaType.STRING },
                  currency: { type: apigateway.JsonSchemaType.STRING },
                  payerMessage: { type: apigateway.JsonSchemaType.STRING },
                  payeeNote: { type: apigateway.JsonSchemaType.STRING },
                },
              },
            },
          },
        },
        responseModel: {
          modelName: 'MTNPaymentWebhookResponseModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              message: { type: apigateway.JsonSchemaType.STRING },
            },
          },
        },
      },
      {
        path: 'webhooks/mtn/disbursement',
        method: 'POST',
        lambda: mtnDisbursementWebhookLambda.lambda,
        apiKeyRequired: false,
        requestModel: {
          modelName: 'MTNDisbursementWebhookRequestModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              type: { type: apigateway.JsonSchemaType.STRING },
              data: {
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                  transactionId: { type: apigateway.JsonSchemaType.STRING },
                  status: { type: apigateway.JsonSchemaType.STRING },
                  reason: { type: apigateway.JsonSchemaType.STRING },
                  amount: { type: apigateway.JsonSchemaType.STRING },
                  currency: { type: apigateway.JsonSchemaType.STRING },
                  payerMessage: { type: apigateway.JsonSchemaType.STRING },
                  payeeNote: { type: apigateway.JsonSchemaType.STRING },
                },
              },
            },
          },
        },
        responseModel: {
          modelName: 'MTNDisbursementWebhookResponseModel',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              message: { type: apigateway.JsonSchemaType.STRING },
            },
          },
        },
      },
    ];

    // Create API Gateway with WAF association
    const apiGateway = new ApiGatewayConstruct(this, 'ApiGateway', {
      envName: props.envName,
      namespace: props.namespace,
      resources,
      webAcl: wafConstruct.webAcl,
    });

    // This is required to add the circular dependencies
    new UpdateLambdaEnv(
      this,
      'UpdateLambdaEnvironmentForTransactionProcessLambda',
      {
        lambda: transactionsProcessLambda.lambda,
        apiGateway: apiGateway.api,
        stage: props.envName,
        envName: props.envName,
        currentEnvVars: {
          LOG_LEVEL: props.envConfigs.LOG_LEVEL,
          STRIPE_API_SECRET: stripeSecret.secretName,
          MTN_TARGET_ENVIRONMENT:
            (process.env.MTN_TARGET_ENVIRONMENT as string) || 'sandbox',
          MTN_API_SECRET: mtnSecret.secretName,
          ORANGE_API_SECRET: orangeSecret.secretName,
          TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
          PAYQAM_FEE_PERCENTAGE: process.env.PAYQAM_FEE_PERCENTAGE as string,
          ENABLE_CACHE: enableCache ? 'true' : 'false',
          VALKEY_PRIMARY_ENDPOINT: cacheEndpoint || '',
          TRANSACTION_STATUS_TOPIC_ARN: snsConstruct.eventTopic.topicArn,
          KMS_TRANSPORT_KEY: key.keyArn,
        },
        newEnvVars: { MTN_PAYMENT_WEBHOOK_URL: 'webhooks/mtn/payment' },
      }
    );
    new UpdateLambdaEnv(
      this,
      'UpdateLambdaEnvironmentForMTNPaymentWebhookLambda',
      {
        lambda: mtnPaymentWebhookLambda.lambda,
        apiGateway: apiGateway.api,
        stage: props.envName,
        envName: props.envName,
        currentEnvVars: {
          LOG_LEVEL: props.envConfigs.LOG_LEVEL,
          MTN_TARGET_ENVIRONMENT: process.env.MTN_TARGET_ENVIRONMENT as string,
          MTN_API_SECRET: mtnSecret.secretName,
          ORANGE_API_SECRET: orangeSecret.secretName,
          TRANSACTIONS_TABLE: dynamoDBConstruct.table.tableName,
          TRANSACTION_STATUS_TOPIC_ARN: snsConstruct.eventTopic.topicArn,
          INSTANT_DISBURSEMENT_ENABLED:
            process.env.INSTANT_DISBURSEMENT_ENABLED || 'true',
          PAYQAM_FEE_PERCENTAGE: process.env.PAYQAM_FEE_PERCENTAGE || '2.5',
        },
        newEnvVars: {
          MTN_PAYMENT_WEBHOOK_URL: 'webhooks/mtn/payment',
          MTN_DISBURSEMENT_WEBHOOK_URL: 'webhooks/mtn/disbursement',
        },
      }
    );

    const lambdaFunctionNames = [
      transactionsProcessLambda.lambda.functionName,
      stripeWebhookLambda.lambda.functionName,
      mtnDisbursementWebhookLambda.lambda.functionName,
      orangeWebhookLambda.lambda.functionName,
      mtnPaymentWebhookLambda.lambda.functionName,
      slackNotifierLambda.lambda.functionName,
      salesforceSyncLambda.lambda.functionName,
    ];
    new LambdaDashboard(this, 'LambdaMonitoringDashboard', {
      envName: props.envName,
      namespace: props.namespace,
      lambdaFunctionNames: lambdaFunctionNames,
    });
    new DynamoDBDashboard(this, 'DynamoDBMonitoringDashboard', {
      envName: props.envName,
      namespace: props.namespace,
      dynamoTableName: dynamoDBConstruct.table.tableName,
    });
    new SNSDashboard(this, 'SnsMonitoringDashboard', {
      envName: props.envName,
      namespace: props.namespace,
      snsTopicName: snsConstruct.eventTopic.topicName,
    });
    new ApiGatewayDashboard(this, 'ApiGatewayMonitoringDashboard', {
      envName: props.envName,
      namespace: props.namespace,
      apiGatewayName: apiGateway.api.restApiName,
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
      value: cacheEndpoint || '',
      description: 'ElastiCache Cluster Name',
    });
  }
}
