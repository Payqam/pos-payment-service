import * as cdk from 'aws-cdk-lib';
import * as xray from 'aws-cdk-lib/aws-xray';
import { Construct } from 'constructs';

export interface PaymentServiceXRayProps {
  envName: string;
}

export class PaymentServiceXRay extends Construct {
  constructor(scope: Construct, id: string, props: PaymentServiceXRayProps) {
    super(scope, id);

    //TODO: uncomment when sampling rule is ready
    // // Create sampling rule
    // new xray.CfnSamplingRule(this, 'PaymentServiceSamplingRule', {
    //   ruleName: `PaymentService-${props.envName}-SamplingRule`,
    //   samplingRate: 0.05, // Sample 5% of requests
    //   reservoirSize: 50,
    //   serviceName: 'pos-payment-service*',
    //   httpMethod: '*',
    //   urlPath: '*',
    //   host: '*',
    //   version: 1,
    // });

    // Create encryption key for X-Ray traces
    new cdk.aws_kms.Key(this, 'XRayEncryptionKey', {
      enableKeyRotation: true,
      description: 'KMS key for X-Ray trace encryption',
      alias: `alias/xray-encryption-${props.envName}`,
    });

    // Add encryption configuration
    new xray.CfnGroup(this, 'PaymentServiceXRayGroup', {
      groupName: `PaymentService-${props.envName}`,
      filterExpression: 'service("pos-payment-service*")',
      insightsConfiguration: {
        insightsEnabled: true,
        notificationsEnabled: true,
      },
    });
  }
}
