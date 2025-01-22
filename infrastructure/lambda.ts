import { Duration } from 'aws-cdk-lib'
import { IFunction, ILayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Construct } from 'constructs'
import { join } from 'path'

interface PAYQAMLambdaProps {
    path: string
    layers?: ILayerVersion[]
    environment?: {
        [key: string]: any
    }
    bundling?: {
        [key: string]: any
    }
    name: string;
}

export class PAYQAMLambda extends Construct {
    public readonly lambda: IFunction

    constructor(scope: Construct, id: string, props: PAYQAMLambdaProps) {
        super(scope, id)
        // Lambda
        this.lambda = this.createLambda(id, props)
    }

    private createLambda(id: string, props: PAYQAMLambdaProps): IFunction {
        const lambda = new NodejsFunction(this, id, {
            entry: join(__dirname, props.path),
            functionName: `PAYQAM-${props.name}`,
            runtime: Runtime.NODEJS_18_X,
            handler: 'handler',
            environment: props.environment,
            layers: props.layers ? props.layers : [],
            timeout: Duration.minutes(1),
            bundling: {
                externalModules: [
                    'cache-manager',
                    'class-validator',
                    'class-transformer',
                ],
            },
        })
        return lambda as IFunction
    }
}
