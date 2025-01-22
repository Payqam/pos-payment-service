import { Logger } from '@aws-lambda-powertools/logger';
import { LambdaLogFormatter } from './logFormatter';
import { configs } from '../../configurations';
import { LogLevel } from '@aws-lambda-powertools/logger/lib/types';

const getLogger = (logLevel: LogLevel = 'INFO'): Logger => {
  return new Logger({
    logLevel,
    serviceName: 'att-appsync-api',
    logFormatter: new LambdaLogFormatter(),
    persistentLogAttributes: {
      env: configs.ENV,
    },
  });
};

export default getLogger;
