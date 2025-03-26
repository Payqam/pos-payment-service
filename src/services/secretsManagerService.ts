import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SMClient } from '../secretsManagerClient';

export class SecretsManagerService {
  private readonly smClient: SMClient;

  private readonly logger: Logger;

  constructor() {
    this.smClient = SMClient.getInstance();
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
        throw new Error(`Secret ${secretName} has no secret string.`);
      }
    } catch (error: unknown) {
      this.logger.debug(`Error details for secret fetch`, {
        secretName,
        errorName: (error as Error).name,
        errorMessage: (error as Error).message,
      });
      this.logger.error(`Error fetching secret ${secretName}:`, error as Error);
      throw error;
    }
  }
}
