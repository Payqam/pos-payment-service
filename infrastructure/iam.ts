import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import getLogger from '../src/internal/logger';

const logger = getLogger();

export class PaymentServiceIAM extends Construct {
  public readonly lambdaRole: iam.Role;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.lambdaRole = new iam.Role(this, 'PaymentServiceLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole'
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    logger.info('Lambda execution role created', {
      roleArn: this.lambdaRole.roleArn,
    });
  }
}
