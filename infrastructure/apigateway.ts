import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

/**
 * Configuration for an API Gateway resource including:
 * - Path and HTTP method
 * - Lambda function for request handling
 * - Request/response models for validation
 * - Query parameters configuration
 */
export interface ResourceConfig {
  path: string;
  method: string;
  lambda: IFunction;
  apiKeyRequired: boolean;
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

/**
 * Properties for configuring the API Gateway including:
 * - Environment name and namespace for resource naming
 * - List of API resources and their configurations
 * - Optional WAF Web ACL for security
 */
export interface ApiGatewayConstructProps {
  envName: string;
  namespace: string;
  resources: ResourceConfig[];
  webAcl?: wafv2.CfnWebACL;
}

/**
 * ApiGatewayConstruct creates a REST API with:
 * - WAF protection
 * - API key authentication
 * - Usage plan with rate limiting
 * - Request/response validation
 * - CORS configuration
 * - CloudWatch logging
 */
export class ApiGatewayConstruct extends Construct {
  public readonly api: apigateway.RestApi;

  public readonly httpApi: apigateway.RestApi | undefined;

  constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
    super(scope, id);

    // Create main HTTPS REST API
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

    // Create HTTP API for MTN webhook in sandbox environment
    if (process.env.MTN_TARGET_ENVIRONMENT === 'sandbox') {
      this.httpApi = new apigateway.RestApi(this, `PAYQAM-HTTP-ApiGateway`, {
        restApiName: `PAYQAM-${props.envName}${props.namespace}-Http-Api`,
        description: 'HTTP API Gateway for MTN webhook in sandbox',
        deployOptions: {
          stageName: props.envName,
        },
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
          allowCredentials: true,
        },
        endpointConfiguration: {
          types: [apigateway.EndpointType.REGIONAL],
        },
        endpointExportName: `PAYQAM-${props.envName}${props.namespace}-Http-Api`,
        disableExecuteApiEndpoint: false,
        binaryMediaTypes: [],
        minimumCompressionSize: 0,
      });
    }

    // Create API key for authentication
    const apiKey = this.api.addApiKey('PAYQAM-ApiKey', {
      apiKeyName: `PAYQAM-${props.envName}${props.namespace}-ApiKey`,
    });

    // Configure usage plan with rate limiting
    const usagePlan = this.api.addUsagePlan('PAYQAM-UsagePlan', {
      name: `PAYQAM-${props.envName}${props.namespace}-UsagePlan`,
      throttle: {
        rateLimit: 100, // 100 requests per second
        burstLimit: 200, // Allow burst up to 200 requests
      },
      quota: {
        limit: 10000, // 10,000 requests per month
        period: apigateway.Period.MONTH,
      },
    });

    // Associate API key with usage plan
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    // Add resources and methods
    props.resources.forEach((config) => {
      // Special handling for MTN webhook in sandbox environment
      if (
        process.env.MTN_TARGET_ENVIRONMENT === 'sandbox' &&
        config.path === '/webhook/mtn'
      ) {
        if (this.httpApi) {
          this.addResourceWithLambda(config, props, this.httpApi);
        }
      }
      // Always add to main HTTPS API
      this.addResourceWithLambda(config, props, this.api);
    });

    // Associate WAF Web ACL with API Gateway if provided
    if (props.webAcl) {
      new wafv2.CfnWebACLAssociation(this, 'ApiGatewayWAFAssociation', {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: props.webAcl.attrArn,
      });
    }
  }

  /**
   * Creates an API Gateway resource with:
   * - Lambda integration
   * - Request/response models
   * - Request validation
   * - API key requirement
   * - Support for nested paths
   */
  private addResourceWithLambda(
    config: ResourceConfig,
    props: ApiGatewayConstructProps,
    api: apigateway.RestApi
  ) {
    // Handle nested paths (e.g., 'parent/child')
    const pathParts = config.path.split('/');
    let currentResource = api.root;

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
      requestModel = api.addModel(config.requestModel.modelName, {
        contentType: 'application/json',
        modelName: config.requestModel.modelName,
        schema: config.requestModel.schema,
      });
    }

    // Create and attach response model if provided
    if (config.responseModel) {
      responseModel = api.addModel(config.responseModel.modelName, {
        contentType: 'application/json',
        modelName: config.responseModel.modelName,
        schema: config.responseModel.schema,
      });
    }

    // Create request validator for the method
    const requestValidator = api.addRequestValidator(
      `PAYQAM-${props.envName}${props.namespace}-RequestValidator-${config.path}-${config.method}`,
      {
        requestValidatorName: `PAYQAM-${props.envName}${props.namespace}-RequestValidator-${config.path}-${config.method}`,
        validateRequestBody: !!requestModel,
        validateRequestParameters: !!config.requestParameters,
      }
    );

    // Add Lambda integration
    const integration = new apigateway.LambdaIntegration(config.lambda);

    // Configure method options with validation and models
    const methodOptions: apigateway.MethodOptions = {
      requestValidator,
      apiKeyRequired: config.apiKeyRequired ?? false,
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

    // Add method to the resource
    currentResource.addMethod(config.method, integration, methodOptions);
  }
}
