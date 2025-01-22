import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Environment } from "aws-cdk-lib";

/**
 * PaymentServiceIAM construct creates and manages IAM roles and policies for the payment service.
 * This includes permissions for Lambda functions to interact with DynamoDB, SNS, and Secrets Manager.
 */
export class PaymentServiceIAM extends Construct {
    public readonly lambdaRole: iam.Role;
    public readonly dynamoDBPolicy: iam.PolicyStatement;
    public readonly snsPolicy: iam.PolicyStatement;
    public readonly secretsManagerPolicy: iam.PolicyStatement;

    constructor(scope: Construct, id: string, env: Environment) {
        super(scope, id);

        // Create Lambda execution role with basic permissions
        this.lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Execution role for PayQAM Lambda functions',
        });

        // Add AWS managed policies for Lambda VPC access and basic execution
        this.lambdaRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
        );
        this.lambdaRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        );

        // DynamoDB policy for transaction data access
        this.dynamoDBPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:PutItem',    // Create new transactions
                'dynamodb:GetItem',     // Retrieve transaction details
                'dynamodb:UpdateItem',  // Update transaction status
                'dynamodb:DeleteItem',  // Clean up failed transactions
                'dynamodb:Query',       // Search transactions
                'dynamodb:Scan'         // List transactions (use sparingly)
            ],
            resources: [`arn:aws:dynamodb:${env.region}:${env.account}:table/PayQAM-*`]
        });

        // SNS policy for payment event publishing
        // Used by transaction processor to publish events and Salesforce sync Lambda to subscribe
        this.snsPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'sns:Publish',      // Allow publishing payment events
                'sns:Subscribe',    // Allow Lambda to subscribe to topics
                'sns:Unsubscribe'   // Allow removing subscriptions if needed
            ],
            resources: [`arn:aws:sns:${env.region}:${env.account}:*`]
        });

        // Secrets Manager policy for accessing Salesforce credentials
        // Used by Salesforce sync Lambda to securely retrieve API credentials
        this.secretsManagerPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'secretsmanager:GetSecretValue',    // Retrieve Salesforce credentials
                'secretsmanager:DescribeSecret'      // Check secret metadata
            ],
            resources: [`arn:aws:secretsmanager:${env.region}:${env.account}:secret:PayQAM/Salesforce-*`]
        });
    }
}
