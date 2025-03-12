import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * PaymentServiceVPC creates a minimal VPC configuration:
 * - Creates 4 subnets total (2 AZs × 2 subnet types)
 * - Each subnet has 32 IP addresses
 * - Total IP addresses: 128 (optimized for small deployments)
 * - Maintains high availability across 2 AZs
 */
export class PaymentServiceVPC extends Construct {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Try to get an existing VPC by name
    this.vpc = ec2.Vpc.fromLookup(this, 'ExistingVPC', {
      isDefault: false, // Ensure it's not the default VPC
      vpcName: 'pos-payment-service-backend-SQA/VPC/PaymentServiceVPC',
    });

    if (!this.vpc) {
      this.vpc = new ec2.Vpc(this, 'PaymentServiceVPC', {
        vpcName: 'PaymentServiceSharedVPC',
        maxAzs: 2,
        ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/24'), // Smaller CIDR range
        subnetConfiguration: [
          {
            cidrMask: 27, // 32 IPs per subnet
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
          },
          {
            cidrMask: 27, // 32 IPs per subnet
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
        ],
        natGateways: 1, // Reduce to 1 NAT Gateway to save costs
      });
    }
  }
}
