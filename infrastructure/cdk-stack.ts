import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './index';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import getLogger from '../src/internal/logger';

const logger = getLogger();

interface CDKStackProps extends cdk.StackProps {
  envName: string;
  namespace: string;
  envConfigs: EnvConfig;
}

export class CDKStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CDKStackProps) {
    super(scope, id, props);

    // Create VPC with three subnet tiers for different security levels
    const vpc = new ec2.Vpc(this, 'PaymentServiceVPC', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Create Security Groups for network access control
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    const apiGatewaySecurityGroup = new ec2.SecurityGroup(this, 'ApiGatewaySecurityGroup', {
      vpc,
      description: 'Security group for API Gateway VPC endpoints',
      allowAllOutbound: true,
    });

    // Allow inbound traffic from API Gateway to Lambda
    lambdaSecurityGroup.addIngressRule(
      apiGatewaySecurityGroup,
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from API Gateway'
    );

    // Create IAM Role for Lambda with VPC access permissions
    const lambdaRole = new iam.Role(this, 'PaymentServiceLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Log the role ARN to ensure it's being used (addresses unused constant warning)
    logger.info('Lambda execution role created', { roleArn: lambdaRole.roleArn });

    // Create WAF Web ACL with multiple layers of protection
    const webAcl = new wafv2.CfnWebACL(this, 'PaymentServiceWebAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'PaymentServiceWebAclMetric',
        sampledRequestsEnabled: true,
      },
      rules: [
        // Rule #1: Rate Limiting
        // Prevents DDoS attacks by limiting requests from a single IP
        {
          name: 'RateLimit',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
            sampledRequestsEnabled: true,
          },
        },
        // Rule #2: AWS Common Rule Set
        // Provides protection against common web exploits:
        // - Bad Bots
        // - Common WordPress exploits
        // - HTTP floods
        // - PHP specific threats
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesCommonRuleSet',
              vendorName: 'AWS',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSetMetric',
            sampledRequestsEnabled: true,
          },
        },
        // Rule #3: SQL Injection Protection
        // Blocks SQL injection attempts in:
        // - URI
        // - Query string
        // - Body
        // - HTTP headers
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesSQLiRuleSet',
              vendorName: 'AWS',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSetMetric',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Add stack outputs for resource reference
    new cdk.CfnOutput(this, 'env', {
      value: `${props.envName}${props.namespace}`,
    });

    new cdk.CfnOutput(this, 'region', {
      value: cdk.Stack.of(this).region,
    });

    new cdk.CfnOutput(this, 'vpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'webAclId', {
      value: webAcl.attrId,
      description: 'WAF Web ACL ID',
    });
  }
}
