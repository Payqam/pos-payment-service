import { LogFormatter } from '@aws-lambda-powertools/logger';
import {
  LogAttributes,
  UnformattedAttributes,
} from '@aws-lambda-powertools/logger/lib/types';

type LogFormatterType = LogAttributes;

class LambdaLogFormatter extends LogFormatter {
  public formatAttributes(attributes: UnformattedAttributes): LogFormatterType {
    return {
      message: attributes.message,
      service: attributes.serviceName,
      environment: attributes.environment,
      awsRegion: attributes.awsRegion,
      awsRequestId: attributes.lambdaContext?.awsRequestId,
      lambdaFunction: {
        name: attributes.lambdaContext?.functionName,
        arn: attributes.lambdaContext?.invokedFunctionArn,
        memoryLimitInMB: attributes.lambdaContext?.memoryLimitInMB,
        version: attributes.lambdaContext?.functionVersion,
        coldStart: attributes.lambdaContext?.coldStart,
      },
      logLevel: attributes.logLevel,
      timestamp: attributes.timestamp,
    };
  }
}

export { LambdaLogFormatter };
