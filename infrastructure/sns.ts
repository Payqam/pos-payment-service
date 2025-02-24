import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * Props for PaymentServiceSNS construct
 * @property salesforceSyncLambda - Lambda function that processes Salesforce sync events
 * @property envName - Environment name (e.g., dev, prod)
 * @property namespace - Namespace for resource naming
 */
interface PaymentServiceSNSProps {
  salesforceSyncLambda: IFunction;
  envName: string;
  namespace: string;
}

/**
 * PaymentServiceSNS construct manages the event-driven architecture for Salesforce integration.
 * It creates:
 * 1. SNS Topic - For publishing payment events (created, updated, etc.)
 * 2. DLQ - For handling failed message processing
 * 3. Lambda Subscription - Routes events to Salesforce sync Lambda
 *
 * Event Flow:
 * Transaction Processor -> SNS Topic -> Salesforce Sync Lambda -> (DLQ if failed)
 */
export class PaymentServiceSNS extends Construct {
  public readonly eventTopic: sns.ITopic;

  public readonly dlq: sqs.IQueue;

  constructor(scope: Construct, id: string, props: PaymentServiceSNSProps) {
    super(scope, id);

    // Create DLQ for failed message processing
    // Messages that fail processing will be sent here for investigation
    this.dlq = new sqs.Queue(this, 'SalesforceDLQ', {
      queueName: `salesforce-dlq-${props.envName}-${props.namespace}`,
      retentionPeriod: cdk.Duration.days(14), // Keep failed messages for 2 weeks
    });

    // Create SNS Topic for payment events
    // This topic decouples payment processing from Salesforce sync
    this.eventTopic = new sns.Topic(this, 'SalesforceEventTopic', {
      topicName: `salesforce-events-${props.envName}-${props.namespace}`,
      displayName: 'Salesforce Event Topic',
    });

    // Add Lambda subscription with DLQ and message filtering
    this.eventTopic.addSubscription(
      new subscriptions.LambdaSubscription(props.salesforceSyncLambda, {
        deadLetterQueue: this.dlq, // Failed messages go to DLQ
        // filterPolicy: {
        //   // Only process specific payment events
        //   eventType: sns.SubscriptionFilter.stringFilter({
        //     allowlist: [
        //       'PAYMENT_STATUS_UPDATE', // When payment status changes
        //       'PAYMENT_CREATED', // When new payment is created
        //     ],
        //   }),
        // },
      })
    );

    // Add resource tags for better organization
    cdk.Tags.of(this.eventTopic).add('Service', 'PayQAM');
    cdk.Tags.of(this.eventTopic).add('Environment', props.envName);
    cdk.Tags.of(this.dlq).add('Service', 'PayQAM');
    cdk.Tags.of(this.dlq).add('Environment', props.envName);
  }
}
