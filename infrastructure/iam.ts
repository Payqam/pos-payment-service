import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import getLogger from '../src/internal/logger';

const logger = getLogger();

export class PaymentServiceIAM extends Construct {
  public readonly lambdaRole: Role;

  public readonly dynamoDBPolicy: PolicyStatement;

  public readonly snsPolicy: PolicyStatement;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.dynamoDBPolicy = this.createDynamoDBPolicy();
    this.snsPolicy = this.createSNSPolicy();

    this.lambdaRole = new Role(this, 'PaymentServiceLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole'
        ),
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    logger.info('Lambda execution role created', {
      roleArn: this.lambdaRole.roleArn,
    });
  }

  private createDynamoDBPolicy() {
    return new PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:GeTItem',
        'dynamodb:DeleteItem',
        'dynamodb:Scan',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: [`*`],
    });
  }

  private createSNSPolicy() {
    return new PolicyStatement({
      actions: ['sns:Publish'],
      resources: [`*`],
    });
  }
}
