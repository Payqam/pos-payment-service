import { Logger, LoggerService } from '@mu-ts/logger';
import {
  DecryptCommand,
  DecryptCommandOutput,
  EncryptCommand,
  EncryptCommandOutput,
  KMSClient,
} from '@aws-sdk/client-kms';

export class KmsClient {
  private readonly logger: Logger;

  private readonly kmsClient: KMSClient;

  constructor() {
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.kmsClient = new KMSClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.logger.info('init()');
  }

  public async encryptCommand(
    command: EncryptCommand
  ): Promise<EncryptCommandOutput> {
    this.logger.debug('encryptCommand()', '-->');
    return this.kmsClient.send(command);
  }

  public async decryptCommand(
    command: DecryptCommand
  ): Promise<DecryptCommandOutput> {
    this.logger.debug('decryptCommand()', '-->');
    return this.kmsClient.send(command);
  }
}
