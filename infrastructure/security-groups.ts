import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface SecurityGroupsProps {
  vpc: ec2.IVpc;
}

export class PaymentServiceSecurityGroups extends Construct {
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly apiGatewaySecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SecurityGroupsProps) {
    super(scope, id);

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    this.apiGatewaySecurityGroup = new ec2.SecurityGroup(this, 'ApiGatewaySecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for API Gateway VPC endpoints',
      allowAllOutbound: true,
    });

    // Allow inbound traffic from API Gateway to Lambda
    this.lambdaSecurityGroup.addIngressRule(
      this.apiGatewaySecurityGroup,
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from API Gateway'
    );
  }
}
