import * as xray from 'aws-cdk-lib/aws-xray';
import { Construct } from 'constructs';

export interface PaymentServiceXRayProps {
  envName: string;
  namespace: string;
}

export class PaymentServiceXRay extends Construct {
  constructor(scope: Construct, id: string, props: PaymentServiceXRayProps) {
    super(scope, id);

    //TODO: uncomment when sampling rule is ready
    //  // Create sampling rule
    //  new xray.CfnSamplingRule(this, 'PaymentServiceSamplingRule', {
    //   ruleName: `PaymentService-${props.envName}${props.namespace}-SamplingRule`,
    //   samplingRate: 0.05, // Sample 5% of requests
    //   reservoirSize: 50,
    //   serviceName: 'pos-payment-service*',
    //   httpMethod: '*',
    //   urlPath: '*',
    //   host: '*',
    //   priority: 1,
    //   version: 1,
    // });

    // // Create encryption key for X-Ray traces
    // new cdk.aws_kms.Key(this, 'XRayEncryptionKey', {
    //   enableKeyRotation: true,
    //   description: 'KMS key for X-Ray trace encryption',
    //   alias: `alias/xray-encryption-${props.envName}${props.namespace}`,
    // });

    // Add encryption configuration
    new xray.CfnGroup(this, 'PaymentServiceXRayGroup', {
      groupName: `PaymentService-${props.envName}${props.namespace}`,
      filterExpression: 'service("pos-payment-service*")',
      insightsConfiguration: {
        insightsEnabled: true,
        notificationsEnabled: true,
      },
    });
  }
}
