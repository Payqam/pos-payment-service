import { Logger, LoggerService } from '@mu-ts/logger';
import {
  DecryptCommand,
  DecryptCommandOutput,
  EncryptCommand,
  EncryptCommandOutput,
  KMSClient,
} from '@aws-sdk/client-kms';
import {
  maskSensitiveValue,
  registerRedactFilter,
  SENSITIVE_FIELDS,
} from '../utils/redactUtil';

// Register additional sensitive fields specific to KMS operations
const kmsSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'KeyId',
  'CiphertextBlob',
  'Plaintext',
  'EncryptionContext',
  'GrantTokens',
];

registerRedactFilter(kmsSensitiveFields);

export class KmsClient {
  private readonly logger: Logger;

  private readonly kmsClient: KMSClient;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';

    this.logger = LoggerService.named(this.constructor.name);

    this.logger.debug('Initializing KmsClient', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      region,
    });

    this.kmsClient = new KMSClient({
      region,
    });

    this.logger.debug('KmsClient initialized', {
      timestamp: new Date().toISOString(),
      region,
    });

    this.logger.info('init()');
  }

  public async encryptCommand(
    command: EncryptCommand
  ): Promise<EncryptCommandOutput> {
    const operationContext = {
      operation: 'encryptCommand',
      commandName: command.constructor.name,
      hasKeyId: !!command.input.KeyId,
      maskedKeyId: command.input.KeyId
        ? maskSensitiveValue(command.input.KeyId, '*', 4)
        : undefined,
      plaintextSize: command.input.Plaintext
        ? Buffer.isBuffer(command.input.Plaintext)
          ? command.input.Plaintext.length
          : (command.input.Plaintext as Uint8Array).length
        : 0,
      hasEncryptionContext:
        !!command.input.EncryptionContext &&
        Object.keys(command.input.EncryptionContext || {}).length > 0,
      encryptionContextKeys: command.input.EncryptionContext
        ? Object.keys(command.input.EncryptionContext)
        : [],
      startTime: Date.now(),
    };

    this.logger.debug('Encrypting data with KMS', operationContext);
    this.logger.debug('encryptCommand()', '-->');

    try {
      const result = await this.kmsClient.send(command);

      this.logger.debug('KMS encryption completed successfully', {
        ...operationContext,
        statusCode: result.$metadata.httpStatusCode,
        requestId: result.$metadata.requestId,
        ciphertextSize: result.CiphertextBlob
          ? Buffer.isBuffer(result.CiphertextBlob)
            ? result.CiphertextBlob.length
            : (result.CiphertextBlob as Uint8Array).length
          : 0,
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.error('Error encrypting data with KMS', errorContext);
      throw error;
    }
  }

  public async decryptCommand(
    command: DecryptCommand
  ): Promise<DecryptCommandOutput> {
    const operationContext = {
      operation: 'decryptCommand',
      commandName: command.constructor.name,
      hasKeyId: !!command.input.KeyId,
      maskedKeyId: command.input.KeyId
        ? maskSensitiveValue(command.input.KeyId, '*', 4)
        : undefined,
      ciphertextSize: command.input.CiphertextBlob
        ? Buffer.isBuffer(command.input.CiphertextBlob)
          ? command.input.CiphertextBlob.length
          : (command.input.CiphertextBlob as Uint8Array).length
        : 0,
      hasEncryptionContext:
        !!command.input.EncryptionContext &&
        Object.keys(command.input.EncryptionContext || {}).length > 0,
      encryptionContextKeys: command.input.EncryptionContext
        ? Object.keys(command.input.EncryptionContext)
        : [],
      startTime: Date.now(),
    };

    this.logger.debug('Decrypting data with KMS', operationContext);
    this.logger.debug('decryptCommand()', '-->');

    try {
      const result = await this.kmsClient.send(command);

      this.logger.debug('KMS decryption completed successfully', {
        ...operationContext,
        statusCode: result.$metadata.httpStatusCode,
        requestId: result.$metadata.requestId,
        plaintextSize: result.Plaintext
          ? Buffer.isBuffer(result.Plaintext)
            ? result.Plaintext.length
            : (result.Plaintext as Uint8Array).length
          : 0,
        keyId: result.KeyId
          ? maskSensitiveValue(result.KeyId, '*', 4)
          : undefined,
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.error('Error decrypting data with KMS', errorContext);
      throw error;
    }
  }
}
