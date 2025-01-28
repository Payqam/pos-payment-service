import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

/**
 * PaymentServiceWAF creates a Web Application Firewall (WAF) configuration with the following rules:
 * 1. Rate Limiting: Limits requests to 2000 per IP to prevent DDoS attacks
 * 2. AWS Common Rule Set: Protects against common web vulnerabilities
 * 3. SQL Injection Protection: Prevents SQL injection attacks
 *
 * The WAF is configured to:
 * - Monitor and log all requests
 * - Enable CloudWatch metrics for monitoring
 * - Sample requests for analysis
 * - Block malicious requests automatically
 */
export class PaymentServiceWAF extends Construct {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create WAF Web ACL with default allow action
    this.webAcl = new wafv2.CfnWebACL(this, 'PaymentServiceWebAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'PaymentServiceWebAclMetric',
        sampledRequestsEnabled: true,
      },
      rules: [
        // Rule #1: Rate Limiting - Prevents DDoS attacks by limiting requests per IP
        {
          name: 'RateLimit',
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: 2000, // Maximum requests per 5-minute period
              aggregateKeyType: 'IP',
            },
          },
          action: {
            block: {},
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
            sampledRequestsEnabled: true,
          },
        },
        // Rule #2: AWS Common Rule Set - Protects against common web vulnerabilities
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              excludedRules: [], // No rules excluded from the common rule set
            },
          },
          overrideAction: {
            none: {}, // Use default actions defined in the rule group
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSetMetric',
            sampledRequestsEnabled: true,
          },
        },
        // Rule #3: SQL Injection Protection - Prevents SQL injection attacks
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
              excludedRules: [], // No rules excluded from SQL injection protection
            },
          },
          overrideAction: {
            none: {}, // Use default actions defined in the rule group
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSetMetric',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
  }
}
