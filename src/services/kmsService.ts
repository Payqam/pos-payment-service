import { KmsClient } from '../kmsClient';
import { DecryptCommand } from '@aws-sdk/client-kms';
import { TextDecoder } from 'util';
import { Logger, LoggerService } from '@mu-ts/logger';

export class KmsService {
  private readonly kmsClient: KmsClient;

  private readonly logger: Logger;

  constructor() {
    this.kmsClient = new KmsClient();
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.info('KmsService initialized');
  }

  public async decryptData(encryptedData: string): Promise<string> {
    try {
      this.logger.debug('Decrypting data with KMS', {
        keyId: process.env.KMS_TRANSPORT_KEY,
        dataLength: encryptedData.length,
      });

      const command = new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedData, 'base64'),
        KeyId: process.env.KMS_TRANSPORT_KEY,
      });

      const response = await this.kmsClient.decryptCommand(command);

      if (!response.Plaintext) {
        this.logger.error(
          'KMS decryption returned an empty plaintext response'
        );
        throw new Error('KMS decryption returned an empty plaintext response');
      }

      this.logger.debug('Data decrypted successfully');
      return new TextDecoder().decode(response.Plaintext);
    } catch (error) {
      this.logger.error('KMS decryption failed:', error);
      console.error('KMS decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }
}
