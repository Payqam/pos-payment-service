import {
  SecretsManagerClient,
  GetSecretValueCommandOutput,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';

export class SMClient {
  private static instance: SMClient;

  private readonly SecretsManagerClient: SecretsManagerClient;

  private readonly logger: Logger;

  constructor() {
    this.SecretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION,
    });
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.info('init()');
  }

  /**
   * Returns the singleton instance of the SMClient.
   */
  public static getInstance(): SMClient {
    if (!SMClient.instance) {
      SMClient.instance = new SMClient();
    }
    return SMClient.instance;
  }

  public send(
    command: GetSecretValueCommand
  ): Promise<GetSecretValueCommandOutput> {
    return this.SecretsManagerClient.send(command);
  }
}
