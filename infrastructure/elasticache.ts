import * as cdk from 'aws-cdk-lib';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

/**
 * Properties for configuring the ElastiCache cluster
 */
export interface ElasticCacheConstructProps {
  envName: string;
  namespace: string;
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
}

export class ElasticCacheConstruct extends Construct {
  public readonly cluster: elasticache.CfnReplicationGroup;

  public readonly parameterGroup: elasticache.CfnParameterGroup;

  constructor(scope: Construct, id: string, props: ElasticCacheConstructProps) {
    super(scope, id);

    const subnetGroup = new elasticache.CfnSubnetGroup(
      this,
      'CacheSubnetGroup',
      {
        description: 'Subnet group for ElasticCache cluster',
        subnetIds: props.vpc.privateSubnets.map((subnet) => subnet.subnetId),
        cacheSubnetGroupName: `payqam-${props.envName}${props.namespace}-cache-subnet-group`,
      }
    );

    this.parameterGroup = new elasticache.CfnParameterGroup(
      this,
      'ParameterGroup',
      {
        description: 'Valkey parameter group',
        cacheParameterGroupFamily: 'valkey7',
      }
    );

    this.cluster = new elasticache.CfnReplicationGroup(
      this,
      'ReplicationGroup',
      {
        replicationGroupDescription: 'valkey-cache',
        engine: 'valkey',
        engineVersion: '7.2',
        cacheNodeType: 'cache.t3.micro',
        cacheSubnetGroupName: subnetGroup.ref,
        cacheParameterGroupName: this.parameterGroup.ref,
        numNodeGroups: 1,
        replicasPerNodeGroup: 1,
        securityGroupIds: [props.securityGroup.securityGroupId],
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: true,
        snapshotRetentionLimit: 7,
        snapshotWindow: '03:00-04:00',
        preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
        port: 6379,
        autoMinorVersionUpgrade: true,
      }
    );

    this.createCloudWatchAlarms();
  }

  /**
   * Creates CloudWatch alarms for monitoring the Redis cluster
   * - Memory usage
   * - CPU utilization
   * - Cache hits/misses
   * - Evictions
   */
  private createCloudWatchAlarms(): void {
    // Memory usage alarm
    new cloudwatch.Alarm(this, 'CacheMemoryUsage', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'FreeableMemory',
        dimensionsMap: {
          CacheClusterId: this.cluster.ref,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 100_000_000, // 100MB
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Alert when free memory is low',
    });

    // CPU utilization alarm
    new cloudwatch.Alarm(this, 'CacheCPUUtilization', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          CacheClusterId: this.cluster.ref,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 90,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Alert when CPU utilization is high',
    });

    // Cache hit ratio alarm
    new cloudwatch.Alarm(this, 'CacheHitRatio', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'CacheHitRate',
        dimensionsMap: {
          CacheClusterId: this.cluster.ref,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 50,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Alert when cache hit ratio is low',
    });
  }
}
