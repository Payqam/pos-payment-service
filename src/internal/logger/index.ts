import { Logger } from '@aws-lambda-powertools/logger';
import { LambdaLogFormatter } from './logFormatter';
import { configs } from '../../configurations';

const getLogger = (logLevel: any = 'INFO'): Logger => {
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
