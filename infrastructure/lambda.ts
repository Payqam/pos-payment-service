import { Duration } from 'aws-cdk-lib';
import {
  IFunction,
  ILayerVersion,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';

interface PAYQAMLambdaProps {
  path: string;
  layers?: ILayerVersion[];
  environment?: {
    [key: string]: string;
  };
  bundling?: {
    [key: string]: string;
  };
  name: string;
  vpc?: IVpc;
  securityGroup?: ISecurityGroup;
}

export class PAYQAMLambda extends Construct {
  public readonly lambda: IFunction;

  constructor(scope: Construct, id: string, props: PAYQAMLambdaProps) {
    super(scope, id);
    this.lambda = this.createLambda(id, props);
  }

  private createLambda(id: string, props: PAYQAMLambdaProps): IFunction {
    const lambda = new NodejsFunction(this, id, {
      entry: join(__dirname, props.path),
      functionName: `PAYQAM-${props.name}`,
      runtime: Runtime.NODEJS_18_X,
      handler: 'handler',
      environment: {
        ...props.environment,
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      layers: props.layers ? props.layers : [],
      timeout:
        props.name.toLowerCase().includes('mtn') &&
        props.name.toLowerCase().includes('webhook')
          ? Duration.minutes(5) // 5 minute timeout for MTN webhook lambdas
          : Duration.minutes(1), // Default 1 minute timeout for other lambdas
      vpc: props.vpc,
      tracing: Tracing.ACTIVE,
      securityGroups: props.securityGroup ? [props.securityGroup] : [],
      bundling: {
        nodeModules:[
          'failure-lambda',
          'aws-sdk'
        ],
        externalModules: [
          'cache-manager',
          'class-validator',
          'class-transformer',
          'aws-xray-sdk-core',
        ],
        sourceMap: true,
      },
    });
    return lambda as IFunction;
  }
}
