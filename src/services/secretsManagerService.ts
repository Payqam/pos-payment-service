import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';
import { SMClient } from '../secretsManagerClient';

export class SecretsManagerService {
  private readonly smClient: SMClient;

  private readonly logger: Logger;

  constructor() {
    this.smClient = new SMClient();
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.info('SecretsManagerService initialized');
  }

  public async getSecret(secretName: string): Promise<Record<string, string>> {
    try {
      this.logger.info(`Fetching secret: ${secretName}`);
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await this.smClient.send(command);

      if (response.SecretString) {
        this.logger.info(`Successfully retrieved secret: ${secretName}`);
        return JSON.parse(response.SecretString);
      } else {
        throw new Error(`Secret ${secretName} has no secret string.`);
      }
    } catch (error: unknown) {
      this.logger.error(`Error fetching secret ${secretName}:`, error as Error);
      throw error;
    }
  }
}
