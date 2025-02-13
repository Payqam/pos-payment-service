import { KmsClient } from '../kmsClient';
import { DecryptCommand } from '@aws-sdk/client-kms';
import { TextDecoder } from 'util';

export class KmsService {
  private readonly kmsClient: KmsClient;

  constructor() {
    this.kmsClient = new KmsClient();
  }

  public async decryptData(encryptedData: string): Promise<string> {
    try {
      const command = new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedData, 'base64'),
        KeyId: process.env.KMS_TRANSPORT_KEY,
      });

      const response = await this.kmsClient.decryptCommand(command);

      if (!response.Plaintext) {
        throw new Error('KMS decryption returned an empty plaintext response');
      }

      return new TextDecoder().decode(response.Plaintext);
    } catch (error) {
      console.error('KMS decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }
}
