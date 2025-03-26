import {
  SecretsManagerClient,
  GetSecretValueCommandOutput,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  maskSensitiveValue,
  registerRedactFilter,
  SENSITIVE_FIELDS,
} from '../utils/redactUtil';

// Register additional sensitive fields specific to Secrets Manager operations
const secretsManagerSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'SecretId',
  'SecretString',
  'SecretBinary',
  'ARN',
  'Name',
  'VersionId',
  'VersionStage',
];

registerRedactFilter(secretsManagerSensitiveFields);

export class SMClient {
  private static instance: SMClient;

  private readonly SecretsManagerClient: SecretsManagerClient;

  private readonly logger: Logger;

  constructor() {
    const region = process.env.AWS_REGION;

    this.logger = LoggerService.named(this.constructor.name);

    this.logger.debug('Initializing SecretsManagerClient', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      region,
    });

    this.SecretsManagerClient = new SecretsManagerClient({
      region,
    });

    this.logger.debug('SecretsManagerClient initialized', {
      timestamp: new Date().toISOString(),
      region,
    });

    this.logger.info('init()');
  }

  /**
   * Returns the singleton instance of the SMClient.
   */
  public static getInstance(): SMClient {
    if (!SMClient.instance) {
      LoggerService.named('SMClient').debug('Creating new SMClient instance');
      SMClient.instance = new SMClient();
    }
    return SMClient.instance;
  }

  public send(
    command: GetSecretValueCommand
  ): Promise<GetSecretValueCommandOutput> {
    const operationContext = {
      operation: 'send',
      commandName: command.constructor.name,
      secretId: command.input.SecretId
        ? maskSensitiveValue(command.input.SecretId, '*', 4)
        : undefined,
      hasVersionId: !!command.input.VersionId,
      versionId: command.input.VersionId
        ? maskSensitiveValue(command.input.VersionId, '*', 4)
        : undefined,
      hasVersionStage: !!command.input.VersionStage,
      startTime: Date.now(),
    };

    this.logger.debug(
      'Retrieving secret from Secrets Manager',
      operationContext
    );

    try {
      const resultPromise = this.SecretsManagerClient.send(command);

      // Add logging for when the promise resolves
      resultPromise
        .then((result) => {
          this.logger.debug(
            'Secret retrieved successfully from Secrets Manager',
            {
              ...operationContext,
              statusCode: result.$metadata.httpStatusCode,
              requestId: result.$metadata.requestId,
              hasSecretString: !!result.SecretString,
              hasSecretBinary: !!result.SecretBinary,
              secretLength: result.SecretString
                ? result.SecretString.length
                : result.SecretBinary
                  ? result.SecretBinary.length
                  : 0,
              arn: result.ARN
                ? maskSensitiveValue(result.ARN, '*', 8)
                : undefined,
              name: result.Name
                ? maskSensitiveValue(result.Name, '*', 4)
                : undefined,
              durationMs: Date.now() - operationContext.startTime,
            }
          );
        })
        .catch((error) => {
          const errorContext = {
            ...operationContext,
            error: error instanceof Error ? error.message : String(error),
            stackTrace: error instanceof Error ? error.stack : undefined,
            durationMs: Date.now() - operationContext.startTime,
          };

          this.logger.error(
            'Error retrieving secret from Secrets Manager',
            errorContext
          );
        });

      return resultPromise;
    } catch (error) {
      // This catch block handles synchronous errors that might occur before the promise is returned
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.error(
        'Error initializing secret retrieval from Secrets Manager',
        errorContext
      );
      throw error;
    }
  }
}
