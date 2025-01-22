import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './index';
import { PaymentServiceVPC } from './vpc';
import { PaymentServiceSecurityGroups } from './security-groups';
import { PaymentServiceIAM } from './iam';
import { PaymentServiceWAF } from './waf';
import getLogger from '../src/internal/logger';
import {ApiGatewayConstruct, ResourceConfig} from './apigateway';
import {PAYQAMLambda} from './lambda';
import {PATHS} from '../configurations/paths';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

const logger = getLogger();

interface CDKStackProps extends cdk.StackProps {
  envName: string;
  namespace: string;
  envConfigs: EnvConfig;
}

export class CDKStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CDKStackProps) {
    super(scope, id, props);

    // Create VPC
    const vpcConstruct = new PaymentServiceVPC(this, 'VPC');

    // Create Security Groups
    const securityGroups = new PaymentServiceSecurityGroups(this, 'SecurityGroups', {
      vpc: vpcConstruct.vpc,
    });

    // Create IAM Roles
    const iamConstruct = new PaymentServiceIAM(this, 'IAM');

    // Create WAF
    const wafConstruct = new PaymentServiceWAF(this, 'WAF');

    // Log the role ARN and security groups to ensure it's being used (addresses unused constant warning)
    logger.info('Lambda execution role created', { roleArn: iamConstruct.lambdaRole.roleArn });
    logger.info('Security groups created', {
      lambdaSecurityGroupId: securityGroups.lambdaSecurityGroup.securityGroupId,
      apiGatewaySecurityGroupId: securityGroups.apiGatewaySecurityGroup.securityGroupId
    });

      const transactionsProcessLambda = new PAYQAMLambda(this, 'TransactionsProcessLambda', {
          name: `TransactionsProcess${props.envName}${props.namespace}`,
          path: `${PATHS.FUNCTIONS.TRANSACTIONS_PROCESS}/handler.ts`,
          vpc: vpcConstruct.vpc,
          environment: {
              LOG_LEVEL: props.envConfigs.LOG_LEVEL,
          },
      });

      const resources: ResourceConfig[] = [
          {
              path: 'process-payments',
              method: 'POST',
              lambda: transactionsProcessLambda.lambda,
              requestModel: {
                  modelName: 'ProcessPaymentsRequestModel',
                  schema: {
                      type: apigateway.JsonSchemaType.OBJECT,
                      properties: {
                          amount: {type: apigateway.JsonSchemaType.NUMBER},//TODO: Update this according to the actual schema
                          currency: {type: apigateway.JsonSchemaType.STRING},
                          paymentMethod: {type: apigateway.JsonSchemaType.STRING},
                      },
                      required: ['amount', 'currency', 'paymentMethod'],
                  },
              },
              responseModel: {
                  modelName: 'ProcessPaymentsResponseModel',
                  schema: {
                      type: apigateway.JsonSchemaType.OBJECT,
                      properties: {
                          transactionId: {type: apigateway.JsonSchemaType.STRING}, //TODO: Update this according to the actual schema
                          status: {type: apigateway.JsonSchemaType.STRING},
                      },
                  },
              },
          },
          {
              path: 'transaction-status',
              method: 'GET',
              lambda: transactionsProcessLambda.lambda,
              requestParameters: {
                  'method.request.querystring.transactionId': true,       //TODO: Update this according to the actual schema
              },
              responseModel: {
                  modelName: 'TransactionStatusResponseModel',
                  schema: {
                      type: apigateway.JsonSchemaType.OBJECT,
                      properties: {
                          transactionId: {type: apigateway.JsonSchemaType.STRING},
                          status: {type: apigateway.JsonSchemaType.STRING},
                      },
                  },
              },
          },
      ];

      new ApiGatewayConstruct(this, 'ApiGateway', {
          envName: props.envName,
          namespace: props.namespace,
          resources,
      });

    // Add stack outputs
    new cdk.CfnOutput(this, 'env', {
      value: `${props.envName}${props.namespace}`,
    });

    new cdk.CfnOutput(this, 'region', {
      value: cdk.Stack.of(this).region,
    });

    new cdk.CfnOutput(this, 'vpcId', {
      value: vpcConstruct.vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'webAclId', {
      value: wafConstruct.webAcl.attrId,
      description: 'WAF Web ACL ID',
    });
  }
}
