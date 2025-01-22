import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {ApiGatewayConstruct, ResourceConfig} from './apigateway';
import {PAYQAMLambda} from './lambda';
import {PATHS} from '../configurations/paths';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';


interface CDKStackProps extends cdk.StackProps {
    envName: string;
    namespace: string;
    envConfigs: { LOG_LEVEL: string };
}

export class CDKStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CDKStackProps) {
        super(scope, id, props);

        const transactionsProcessLambda = new PAYQAMLambda(this, 'TransactionsProcessLambda', {
            name: `TransactionsProcess${props.envName}${props.namespace}`,
            path: `${PATHS.FUNCTIONS.TRANSACTIONS_PROCESS}/handler.ts`,
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

        new cdk.CfnOutput(this, 'Environment', {
            value: `${props.envName}${props.namespace}`,
        });

        new cdk.CfnOutput(this, 'Region', {
            value: cdk.Aws.REGION,
        });
    }
}
