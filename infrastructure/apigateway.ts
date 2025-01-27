import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

export interface ResourceConfig {
  path: string;
  method: string;
  lambda: IFunction;
  requestModel?: {
    modelName: string;
    schema: apigateway.JsonSchema;
  };
  responseModel?: {
    modelName: string;
    schema: apigateway.JsonSchema;
  };
  requestParameters?: { [key: string]: boolean };
}

export interface ApiGatewayConstructProps {
  envName: string;
  namespace: string;
  resources: ResourceConfig[];
}

export class ApiGatewayConstruct extends Construct {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
    super(scope, id);

    // Create the API Gateway
    this.api = new apigateway.RestApi(this, `PAYQAM-ApiGateway`, {
      restApiName: `PAYQAM-${props.envName}${props.namespace}-Api`,
      description:
        'API Gateway dynamically configured with resources and models',
      deployOptions: {
        stageName: props.envName,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowCredentials: true,
      },
    });

    // Create API Key and Usage Plan
    const apiKey = this.api.addApiKey('PAYQAM-ApiKey', {
      apiKeyName: `PAYQAM-${props.envName}${props.namespace}-ApiKey`,
    });
    //TODO: Update usage plan
    const usagePlan = this.api.addUsagePlan('UsagePlan', {
      name: `${props.envName}${props.namespace}-UsagePlan`,
      throttle: {
        rateLimit: 10,
        burstLimit: 2,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    // Register resources and methods dynamically
    props.resources.forEach((resourceConfig) => {
      this.addResourceWithLambda(resourceConfig, props);
    });
  }

  private addResourceWithLambda(
    config: ResourceConfig,
    props: ApiGatewayConstructProps
  ) {
    // Handle nested paths
    const pathParts = config.path.split('/');
    let currentResource = this.api.root;

    // Create nested resources
    pathParts.forEach((part) => {
      let resource = currentResource.getResource(part);
      if (!resource) {
        resource = currentResource.addResource(part);
      }
      currentResource = resource;
    });

    let requestModel: apigateway.IModel | undefined;
    let responseModel: apigateway.IModel | undefined;

    // Create and attach request model if provided
    if (config.requestModel) {
      requestModel = this.api.addModel(config.requestModel.modelName, {
        contentType: 'application/json',
        modelName: config.requestModel.modelName,
        schema: config.requestModel.schema,
      });
    }

    // Create and attach response model if provided
    if (config.responseModel) {
      responseModel = this.api.addModel(config.responseModel.modelName, {
        contentType: 'application/json',
        modelName: config.responseModel.modelName,
        schema: config.responseModel.schema,
      });
    }

    const requestValidator = this.api.addRequestValidator(
      `PAYQAM-${props.envName}${props.namespace}-RequestValidator-${config.path}-${config.method}`,
      {
        requestValidatorName: `PAYQAM-${props.envName}${props.namespace}-RequestValidator-${config.path}-${config.method}`,
        validateRequestBody: !!requestModel,
        validateRequestParameters: !!config.requestParameters,
      }
    );

    // Add method to the resource
    const integration = new apigateway.LambdaIntegration(config.lambda);

    // Create method options
    const methodOptions: apigateway.MethodOptions = {
      requestValidator,
      apiKeyRequired: true,
      requestModels: requestModel
        ? { 'application/json': requestModel }
        : undefined,
      requestParameters: config.requestParameters,
      methodResponses: responseModel
        ? [
            {
              statusCode: '200',
              responseModels: {
                'application/json': responseModel,
              },
            },
          ]
        : undefined,
    };

    currentResource.addMethod(config.method, integration, methodOptions);
  }
}
