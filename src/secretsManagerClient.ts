import {
  SecretsManagerClient,
  GetSecretValueCommandOutput,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Logger, LoggerService } from '@mu-ts/logger';

export class SMClient {
  private readonly SecretsManagerClient: SecretsManagerClient;

  private readonly logger: Logger;

  constructor() {
    this.SecretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION,
    });
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.info('init()');
  }

  public send(
    command: GetSecretValueCommand
  ): Promise<GetSecretValueCommandOutput> {
    return this.SecretsManagerClient.send(command);
  }
}
