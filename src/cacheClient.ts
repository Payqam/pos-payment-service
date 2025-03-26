import Redis from 'ioredis';
import { Logger, LoggerService } from '@mu-ts/logger';
import {
  maskSensitiveValue,
  registerRedactFilter,
  SENSITIVE_FIELDS,
} from '../utils/redactUtil';

// Register additional sensitive fields specific to cache operations
const cacheSensitiveFields = [
  ...SENSITIVE_FIELDS,
  'key',
  'value',
  'cache',
  'redis',
];

registerRedactFilter(cacheSensitiveFields);

export class CacheClient {
  private static instance: CacheClient;

  private readonly redisClient: Redis;

  private readonly logger: Logger;

  private constructor() {
    const host = process.env.VALKEY_PRIMARY_ENDPOINT as string;
    const port = 6379;

    this.redisClient = new Redis({
      host,
      port,
      tls: {}, // Add necessary TLS configuration if required
    });

    this.logger = LoggerService.named(this.constructor.name);

    this.logger.debug('Initializing CacheClient', {
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      maskedHost: maskSensitiveValue(host, '*', 4),
      port,
    });

    this.logger.info('CacheClient initialized');

    this.redisClient.on('connect', () => {
      this.logger.debug('Connected to Redis', {
        timestamp: new Date().toISOString(),
        maskedHost: maskSensitiveValue(host, '*', 4),
        port,
      });
      this.logger.info('Connected to Redis');
    });

    this.redisClient.on('error', (error) => {
      this.logger.debug('Redis connection error', {
        timestamp: new Date().toISOString(),
        maskedHost: maskSensitiveValue(host, '*', 4),
        port,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      });
      this.logger.error('Redis connection error:', error);
    });
  }

  /**
   * Returns the singleton instance of CacheClient.
   */
  public static getInstance(): CacheClient {
    if (!CacheClient.instance) {
      LoggerService.named('CacheClient').debug(
        'Creating new CacheClient instance'
      );
      CacheClient.instance = new CacheClient();
    }
    return CacheClient.instance;
  }

  /**
   * Stores a value in Redis with an optional expiration time.
   * @param key - The key to store the value under.
   * @param value - The value to store.
   * @param ttlSeconds - Optional time-to-live in seconds.
   */
  public async setValue<T>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const operationContext = {
      operation: 'setValue',
      maskedKey: maskSensitiveValue(key, '*', 4),
      valueType: typeof value,
      valueSize:
        typeof value === 'object'
          ? JSON.stringify(value).length
          : String(value).length,
      ttlSeconds,
      startTime: Date.now(),
    };

    this.logger.debug('Setting value in Redis', operationContext);

    try {
      const stringValue = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redisClient.set(key, stringValue, 'EX', ttlSeconds);
        this.logger.debug('Set value in Redis with expiration', {
          ...operationContext,
          durationMs: Date.now() - operationContext.startTime,
        });
      } else {
        await this.redisClient.set(key, stringValue);
        this.logger.debug('Set value in Redis without expiration', {
          ...operationContext,
          durationMs: Date.now() - operationContext.startTime,
        });
      }
      this.logger.info(`Value set in Redis for key: ${key}`);
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.debug('Error setting value in Redis', errorContext);
      this.logger.error('Error setting value in Redis', error);
      throw error;
    }
  }

  /**
   * Retrieves a value from Redis.
   * @param key - The key to retrieve the value for.
   * @returns The stored value or null if not found.
   */
  public async getValue<T>(key: string): Promise<T | null> {
    const operationContext = {
      operation: 'getValue',
      maskedKey: maskSensitiveValue(key, '*', 4),
      startTime: Date.now(),
    };

    this.logger.debug('Retrieving value from Redis', operationContext);

    try {
      const value = await this.redisClient.get(key);

      const resultContext = {
        ...operationContext,
        found: !!value,
        valueSize: value ? value.length : 0,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.debug('Retrieved value from Redis', resultContext);

      return value ? JSON.parse(value) : null;
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.debug('Error retrieving value from Redis', errorContext);
      this.logger.error('Error retrieving value from Redis', error);
      throw error;
    }
  }

  /**
   * Deletes a value from Redis.
   * @param key - The key to delete.
   */
  public async deleteValue(key: string): Promise<void> {
    const operationContext = {
      operation: 'deleteValue',
      maskedKey: maskSensitiveValue(key, '*', 4),
      startTime: Date.now(),
    };

    this.logger.debug('Deleting key from Redis', operationContext);

    try {
      await this.redisClient.del(key);

      this.logger.debug('Deleted key from Redis', {
        ...operationContext,
        durationMs: Date.now() - operationContext.startTime,
      });

      this.logger.info(`Deleted key from Redis: ${key}`);
    } catch (error) {
      const errorContext = {
        ...operationContext,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - operationContext.startTime,
      };

      this.logger.debug('Error deleting value from Redis', errorContext);
      this.logger.error('Error deleting value from Redis', error);
      throw error;
    }
  }
}
