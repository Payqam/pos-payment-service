import { CacheClient } from '../cacheClient';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  maskSensitiveValue,
  registerRedactFilter,
} from '../../utils/redactUtil';
import {
  EnhancedError,
  ErrorCategory,
  ErrorMetadata,
} from '../../utils/errorHandler';

// Register sensitive fields for redaction in logs
const sensitiveFields = [
  'token',
  'apiKey',
  'secret',
  'password',
  'credential',
  'authorization',
  'auth',
  'session',
  'jwt',
  'key',
];

registerRedactFilter(sensitiveFields);

/**
 * Service for interacting with the cache
 */
export class CacheService {
  private readonly cacheClient: CacheClient;

  private readonly logger: Logger;

  constructor() {
    this.cacheClient = CacheClient.getInstance();
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.debug('CacheService initialized', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
    });
  }

  /**
   * Sets a value in the cache with optional TTL
   * @param key - Cache key
   * @param value - Value to store
   * @param ttlSeconds - Optional TTL in seconds
   */
  public async setValue<T>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const operationContext = {
      operation: 'setValue',
      maskedKey: this.maskCacheKey(key),
      ttlSeconds,
      valueType: typeof value,
      isObject: typeof value === 'object',
      startTime: Date.now(),
    };

    this.logger.debug('Setting value in cache', operationContext);

    try {
      await this.cacheClient.setValue(key, value, ttlSeconds);

      this.logger.debug('Successfully set value in cache', {
        ...operationContext,
        durationMs: Date.now() - operationContext.startTime,
      });
    } catch (error) {
      this.logger.error('Error setting value in cache', {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      });

      const metadata: ErrorMetadata = {
        retryable: true,
        originalError: error,
      };

      throw new EnhancedError(
        'CACHE_SET_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to set value in cache for key: ${this.maskCacheKey(key)}`,
        metadata
      );
    }
  }

  /**
   * Retrieves a value from the cache
   * @param key - Cache key to retrieve
   * @returns The cached value or null if not found
   */
  public async getValue<T>(key: string): Promise<T | null> {
    const operationContext = {
      operation: 'getValue',
      maskedKey: this.maskCacheKey(key),
      startTime: Date.now(),
    };

    this.logger.debug('Retrieving value from cache', operationContext);

    try {
      const result = await this.cacheClient.getValue<T>(key);

      this.logger.debug('Cache retrieval completed', {
        ...operationContext,
        found: result !== null,
        valueType: result !== null ? typeof result : 'null',
        durationMs: Date.now() - operationContext.startTime,
      });

      return result;
    } catch (error) {
      this.logger.error('Error retrieving value from cache', {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      });

      const metadata: ErrorMetadata = {
        retryable: true,
        originalError: error,
      };

      throw new EnhancedError(
        'CACHE_GET_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to get value from cache for key: ${this.maskCacheKey(key)}`,
        metadata
      );
    }
  }

  /**
   * Deletes a value from the cache
   * @param key - Cache key to delete
   */
  public async deleteValue(key: string): Promise<void> {
    const operationContext = {
      operation: 'deleteValue',
      maskedKey: this.maskCacheKey(key),
      startTime: Date.now(),
    };

    this.logger.debug('Deleting value from cache', operationContext);

    try {
      await this.cacheClient.deleteValue(key);

      this.logger.debug('Successfully deleted value from cache', {
        ...operationContext,
        durationMs: Date.now() - operationContext.startTime,
      });
    } catch (error) {
      this.logger.error('Error deleting value from cache', {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      });

      const metadata: ErrorMetadata = {
        retryable: true,
        originalError: error,
      };

      throw new EnhancedError(
        'CACHE_DELETE_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to delete value from cache for key: ${this.maskCacheKey(key)}`,
        metadata
      );
    }
  }

  /**
   * Masks sensitive information in cache keys
   * @param key - Cache key to mask
   * @returns Masked cache key
   */
  private maskCacheKey(key: string): string {
    // Check if the key contains sensitive information
    const sensitiveKeyPatterns = [
      /token/i,
      /auth/i,
      /key/i,
      /secret/i,
      /password/i,
      /credential/i,
      /session/i,
      /jwt/i,
      /user/i,
      /account/i,
      /phone/i,
      /mobile/i,
      /email/i,
      /transaction/i,
      /payment/i,
      /card/i,
    ];

    const containsSensitiveInfo = sensitiveKeyPatterns.some((pattern) =>
      pattern.test(key)
    );

    if (containsSensitiveInfo) {
      return maskSensitiveValue(key, '*', 3);
    }

    return key;
  }
}
