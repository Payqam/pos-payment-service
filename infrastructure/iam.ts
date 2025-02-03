import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
  Effect,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Environment } from 'aws-cdk-lib';

/**
 * PaymentServiceIAM construct creates and manages IAM roles and policies for the payment service.
 * This includes permissions for Lambda functions to interact with DynamoDB, SNS, and Secrets Manager.
 */

export class PaymentServiceIAM extends Construct {
  public readonly lambdaRole: Role;

  public readonly dynamoDBPolicy: PolicyStatement;

  public readonly snsPolicy: PolicyStatement;

  public readonly secretsManagerPolicy: PolicyStatement;

  constructor(scope: Construct, id: string, env: Environment) {
    super(scope, id);
    this.lambdaRole = this.createLambdaRole();
    this.dynamoDBPolicy = this.createDynamoDBPolicy(env);
    this.snsPolicy = this.createSNSPolicy(env);
    this.secretsManagerPolicy = this.createSecretsManagerPolicy(env);
  }

  // Create Lambda execution role with basic permissions
  private createLambdaRole(): Role {
    const role = new Role(this, 'LambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Lambda execution role for PAYQAM POS Payment Service',
    });

    // Add basic Lambda execution policy
    role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AWSLambdaBasicExecutionRole'
      )
    );

    // Add X-Ray write permissions
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
          'xray:GetSamplingStatisticSummaries',
        ],
        resources: ['*'],
      })
    );

    return role;
  }

  // DynamoDB policy for transaction data access
  private createDynamoDBPolicy(env: Environment) {
    return new PolicyStatement({
      actions: [
        'dynamodb:PutItem', // Create new transactions
        'dynamodb:GetItem', // Retrieve transaction details
        'dynamodb:UpdateItem', // Update transaction status
        'dynamodb:DeleteItem', // Clean up failed transactions
        'dynamodb:Query', // Search transactions
        'dynamodb:Scan', // List transactions (use sparingly)
      ],
      resources: [
        `arn:aws:dynamodb:${env.region}:${env.account}:table/PayQAM-*`,
      ],
    });
  }

  // SNS policy for payment event publishing
  // Used by transaction processor to publish events and Salesforce sync Lambda to subscribe
  private createSNSPolicy(env: Environment) {
    return new PolicyStatement({
      actions: [
        'sns:Publish', // Allow publishing payment events
        'sns:Subscribe', // Allow Lambda to subscribe to topics
        'sns:Unsubscribe', // Allow removing subscriptions if needed
      ],
      resources: [`arn:aws:sns:${env.region}:${env.account}:*`],
    });
  }

  // Secrets Manager policy for accessing Salesforce credentials
  // Used by Salesforce sync Lambda to securely retrieve API credentials
  private createSecretsManagerPolicy(env: Environment) {
    return new PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue', // Retrieve Salesforce credentials
        'secretsmanager:DescribeSecret', // Check secret metadata
      ],
      resources: [
        `arn:aws:secretsmanager:${env.region}:${env.account}:secret:PayQAM/Salesforce-*`,
        `arn:aws:secretsmanager:${env.region}:${env.account}:secret:STRIPE_API_SECRET-*`,
        `arn:aws:secretsmanager:${env.region}:${env.account}:secret:MTN_API_SECRET-*`,
        `arn:aws:secretsmanager:${env.region}:${env.account}:secret:ORANGE_API_SECRET-*`,
      ],
    });
  }
}
