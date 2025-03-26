import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SMClient } from '../secretsManagerClient';
import {
  maskSensitiveValue,
  registerRedactFilter,
  SENSITIVE_FIELDS,
} from '../../utils/redactUtil';
import {
  EnhancedError,
  ErrorCategory,
  ErrorMetadata,
} from '../../utils/errorHandler';

// Register additional sensitive fields specific to Secrets Manager operations
const secretsManagerSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'SecretId',
  'SecretString',
  'secretName',
  'ARN',
  'SecretARN',
  'VersionId',
];

registerRedactFilter(secretsManagerSensitiveFields);

export class SecretsManagerService {
  private readonly smClient: SMClient;

  private readonly logger: Logger;

  constructor() {
    this.smClient = SMClient.getInstance();
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.debug('SecretsManagerService initialized', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
    });
  }

  public async getSecret(secretName: string): Promise<Record<string, string>> {
    const operationContext = {
      operation: 'getSecret',
      maskedSecretName: maskSensitiveValue(secretName, '*', 4),
      startTime: Date.now(),
    };

    this.logger.debug('Fetching secret from Secrets Manager', operationContext);

    try {
      const command = new GetSecretValueCommand({ SecretId: secretName });

      this.logger.debug('Sending GetSecretValueCommand to Secrets Manager', {
        ...operationContext,
        commandName: command.constructor.name,
      });

      const response = await this.smClient.send(command);

      if (response.SecretString) {
        const secretData = JSON.parse(response.SecretString);
        const secretKeys = Object.keys(secretData);

        this.logger.debug('Successfully retrieved secret', {
          ...operationContext,
          secretDataKeys: secretKeys,
          secretDataSize: response.SecretString.length,
          hasSecretString: !!response.SecretString,
          versionId: response.VersionId
            ? maskSensitiveValue(response.VersionId, '*', 4)
            : undefined,
          durationMs: Date.now() - operationContext.startTime,
        });

        return secretData;
      } else {
        this.logger.error('Secret has no secret string', {
          ...operationContext,
          error: `Secret ${maskSensitiveValue(secretName, '*', 4)} has no secret string.`,
          durationMs: Date.now() - operationContext.startTime,
        });

        throw new Error(`Secret ${secretName} has no secret string.`);
      }
    } catch (error: unknown) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.error(
        'Error fetching secret from Secrets Manager',
        errorContext
      );

      if (error instanceof Error) {
        const errorMetadata: ErrorMetadata = {
          retryable: false,
          suggestedAction:
            'Check secret name and AWS Secrets Manager permissions',
          originalError: error,
        };

        throw new EnhancedError(
          'SECRETS_MANAGER_ERROR',
          ErrorCategory.SYSTEM_ERROR,
          `Error fetching secret ${maskSensitiveValue(secretName, '*', 4)}`,
          errorMetadata
        );
      }

      throw error;
    }
  }
}
