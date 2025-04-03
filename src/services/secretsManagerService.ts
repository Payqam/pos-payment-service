import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SMClient } from '../secretsManagerClient';
import { EnhancedError, ErrorCategory } from '../../utils/errorHandler';

export class SecretsManagerService {
  private readonly smClient: SMClient;

  private readonly logger: Logger;

  constructor() {
    this.smClient = SMClient.getInstance();
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.info('SecretsManagerService initialized');
  }

  public async getSecret(secretName: string): Promise<Record<string, string>> {
    try {
      this.logger.debug(`Starting to fetch secret`, { secretName });
      this.logger.info(`Fetching secret: ${secretName}`);
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await this.smClient.send(command);

      if (response.SecretString) {
        this.logger.debug(`Secret retrieved successfully`, {
          secretName,
          secretLength: response.SecretString.length,
        });
        this.logger.info(`Successfully retrieved secret: ${secretName}`);
        return JSON.parse(response.SecretString);
      } else {
        this.logger.debug(`Secret has no string value`, { secretName });
        throw new EnhancedError(
          'SECRET_NOT_FOUND',
          ErrorCategory.SYSTEM_ERROR,
          `Secret ${secretName} has no secret string.`,
          {
            retryable: false,
            suggestedAction: 'Verify the secret exists and has a string value',
          }
        );
      }
    } catch (error: unknown) {
      this.logger.debug(`Error details for secret fetch`, {
        secretName,
        errorName: (error as Error).name,
        errorMessage: (error as Error).message,
      });
      this.logger.error(`Error fetching secret ${secretName}:`, error as Error);

      // If it's already an EnhancedError, just rethrow it
      if (error instanceof EnhancedError) {
        throw error;
      }

      // Otherwise, wrap it in an EnhancedError
      throw new EnhancedError(
        'SECRETS_MANAGER_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to fetch secret: ${secretName}`,
        {
          originalError: error,
          retryable: true,
          suggestedAction:
            'Check AWS Secrets Manager configuration and permissions',
        }
      );
    }
  }
}
