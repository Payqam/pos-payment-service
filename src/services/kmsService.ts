import { KmsClient } from '../kmsClient';
import { DecryptCommand } from '@aws-sdk/client-kms';
import { TextDecoder } from 'util';
import { EnhancedError, ErrorCategory } from '../../utils/errorHandler';

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
        throw new EnhancedError(
          'KMS_EMPTY_RESPONSE',
          ErrorCategory.SYSTEM_ERROR,
          'KMS decryption returned an empty plaintext response',
          {
            retryable: false,
            suggestedAction:
              'Check KMS configuration and encrypted data format',
          }
        );
      }

      return new TextDecoder().decode(response.Plaintext);
    } catch (error) {
      console.error('KMS decryption failed:', error);
      throw new EnhancedError(
        'KMS_DECRYPTION_FAILED',
        ErrorCategory.SYSTEM_ERROR,
        'Failed to decrypt data',
        {
          originalError: error,
          retryable: true,
          suggestedAction:
            'Verify KMS key permissions and encrypted data format',
        }
      );
    }
  }
}
