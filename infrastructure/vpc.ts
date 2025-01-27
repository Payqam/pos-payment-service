import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * PaymentServiceVPC creates an optimized VPC configuration:
 * - Creates 4 subnets total (2 AZs × 2 subnet types)
 * - Each subnet has 64 IP addresses (instead of 256)
 * - Total IP addresses: 256 (down from 1,536)
 * - Maintains high availability across 2 AZs
 */
export class PaymentServiceVPC extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'PaymentServiceVPC', {
      maxAzs: 2,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/21'), // Explicitly set CIDR range
      subnetConfiguration: [
        {
          cidrMask: 26, // 64 IPs per subnet
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 26, // 64 IPs per subnet
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });
  }
}
