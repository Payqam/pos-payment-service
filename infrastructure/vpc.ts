import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';

/**
 * PaymentServiceVPC creates a minimal VPC configuration:
 * - Creates 4 subnets total (2 AZs × 2 subnet types)
 * - Each subnet has 32 IP addresses
 * - Total IP addresses: 128 (optimized for small deployments)
 * - Maintains high availability across 2 AZs
 */
interface PaymentServiceVPCProps extends cdk.StackProps {
  appVpcId: string;
}

export class PaymentServiceVPC extends Construct {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: PaymentServiceVPCProps) {
    super(scope, id);

    // Try to get App VPC
    this.vpc = ec2.Vpc.fromLookup(this, 'PayQam-App-VPC', {
      vpcId: props.appVpcId,
    });
  }
}
