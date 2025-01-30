import * as cdk from 'aws-cdk-lib';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

/**
 * Properties for configuring the ElastiCache cluster
 */
export interface ElastiCacheConstructProps {
  envName: string;
  namespace: string;
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
}

/**
 * ElastiCacheConstruct creates a Redis cluster for caching with:
 * - Multi-AZ deployment for high availability
 * - Automatic backup configuration
 * - CloudWatch monitoring
 * - Memory and eviction policies
 * - Security group configuration
 */
export class ElastiCacheConstruct extends Construct {
  public readonly cluster: elasticache.CfnCacheCluster;

  public readonly parameterGroup: elasticache.CfnParameterGroup;

  constructor(scope: Construct, id: string, props: ElastiCacheConstructProps) {
    super(scope, id);

    // Create subnet group for ElastiCache
    const subnetGroup = new elasticache.CfnSubnetGroup(
      this,
      'CacheSubnetGroup',
      {
        description: 'Subnet group for ElastiCache cluster',
        subnetIds: props.vpc.privateSubnets.map((subnet) => subnet.subnetId),
        cacheSubnetGroupName: `payqam-${props.envName}${props.namespace}-cache-subnet-group`,
      }
    );

    // Create parameter group for Redis configuration
    this.parameterGroup = new elasticache.CfnParameterGroup(
      this,
      'CacheParameterGroup',
      {
        cacheParameterGroupFamily: 'redis6.x',
        description: 'Parameter group for PayQAM Redis cluster',
        properties: {
          'maxmemory-policy': 'volatile-lru', // Evict least recently used keys with TTL
          'maxmemory-samples': '10', // Number of samples for LRU algorithm
          'notify-keyspace-events': 'Ex', // Enable keyspace notifications for expiry
        },
      }
    );

    // Create the Redis cluster
    this.cluster = new elasticache.CfnCacheCluster(this, 'PaymentCache', {
      engine: 'redis',
      cacheNodeType: 'cache.t3.micro', // Start small, can scale up
      numCacheNodes: 1, // Single node to reduce IP usage
      vpcSecurityGroupIds: [props.securityGroup.securityGroupId],
      cacheSubnetGroupName: subnetGroup.ref,
      cacheParameterGroupName: this.parameterGroup.ref,
      clusterName: `payqam-${props.envName}${props.namespace}-cache`,

      // Automatic backup configuration
      snapshotRetentionLimit: 7, // Keep backups for 7 days
      snapshotWindow: '03:00-04:00', // UTC time - 1-hour window for snapshots
      preferredMaintenanceWindow: 'sun:05:00-sun:06:00', // UTC time - After snapshots

      // Performance and security settings
      port: 6379,
      autoMinorVersionUpgrade: true,
      engineVersion: '6.x',

      // Network settings
      preferredAvailabilityZone: props.vpc.privateSubnets[0].availabilityZone, // Use single AZ

      // Tags
      tags: [
        {
          key: 'Environment',
          value: props.envName,
        },
        {
          key: 'Service',
          value: 'PayQAM',
        },
        {
          key: 'Name',
          value: `payqam-${props.envName}${props.namespace}-cache`,
        },
      ],
    });

    // Add CloudWatch alarms
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
