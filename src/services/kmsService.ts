import { KmsClient } from '../kmsClient';
import { DecryptCommand } from '@aws-sdk/client-kms';
import { TextDecoder } from 'util';
import { Logger, LoggerService } from '@mu-ts/logger';
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

// Register additional sensitive fields specific to KMS operations
const kmsSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'KeyId',
  'CiphertextBlob',
  'Plaintext',
  'encryptedData',
];

registerRedactFilter(kmsSensitiveFields);

export class KmsService {
  private readonly kmsClient: KmsClient;

  private readonly logger: Logger;

  constructor() {
    this.kmsClient = new KmsClient();
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.debug('KmsService initialized', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      kmsKeyId: process.env.KMS_TRANSPORT_KEY
        ? maskSensitiveValue(process.env.KMS_TRANSPORT_KEY, '*', 4)
        : 'undefined',
    });
  }

  public async decryptData(encryptedData: string): Promise<string> {
    const operationContext = {
      operation: 'decryptData',
      encryptedDataLength: encryptedData ? encryptedData.length : 0,
      maskedEncryptedData: encryptedData
        ? `${maskSensitiveValue(encryptedData.substring(0, 10), '*', 2)}...`
        : 'undefined',
      keyId: process.env.KMS_TRANSPORT_KEY
        ? maskSensitiveValue(process.env.KMS_TRANSPORT_KEY, '*', 4)
        : 'undefined',
      startTime: Date.now(),
    };

    this.logger.debug('Decrypting data using KMS', operationContext);

    try {
      const command = new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedData, 'base64'),
        KeyId: process.env.KMS_TRANSPORT_KEY,
      });

      this.logger.debug('Sending decrypt command to KMS', {
        ...operationContext,
        commandName: command.constructor.name,
      });

      const response = await this.kmsClient.decryptCommand(command);

      if (!response.Plaintext) {
        this.logger.error('KMS decryption returned empty plaintext', {
          ...operationContext,
          durationMs: Date.now() - operationContext.startTime,
          error: 'Empty plaintext response',
        });
        throw new Error('KMS decryption returned an empty plaintext response');
      }

      const plaintext = new TextDecoder().decode(response.Plaintext);

      this.logger.debug('Successfully decrypted data', {
        ...operationContext,
        plaintextLength: plaintext.length,
        durationMs: Date.now() - operationContext.startTime,
      });

      return plaintext;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.error('KMS decryption failed', errorContext);

      if (error instanceof Error) {
        const errorMetadata: ErrorMetadata = {
          retryable: false,
          suggestedAction:
            'Check KMS key configuration and encrypted data format',
          originalError: error,
        };

        throw new EnhancedError(
          'KMS_DECRYPT_ERROR',
          ErrorCategory.SYSTEM_ERROR,
          'Failed to decrypt data',
          errorMetadata
        );
      }

      throw new Error('Failed to decrypt data');
    }
  }
}
