import Redis from 'ioredis';
import { Logger, LoggerService } from '@mu-ts/logger';

export class CacheClient {
  private static instance: CacheClient;

  private readonly redisClient: Redis;

  private readonly logger: Logger;

  private constructor() {
    this.redisClient = new Redis({
      host: process.env.VALKEY_PRIMARY_ENDPOINT as string,
      port: 6379,
      tls: {}, // Add necessary TLS configuration if required
    });

    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.info('CacheClient initialized');

    this.redisClient.on('connect', () => {
      this.logger.info('Connected to Redis');
    });

    this.redisClient.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });
  }

  /**
   * Returns the singleton instance of CacheClient.
   */
  public static getInstance(): CacheClient {
    if (!CacheClient.instance) {
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
    try {
      const stringValue = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redisClient.set(key, stringValue, 'EX', ttlSeconds);
      } else {
        await this.redisClient.set(key, stringValue);
      }
      this.logger.info(`Value set in Redis for key: ${key}`);
    } catch (error) {
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
    try {
      const value = await this.redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error('Error retrieving value from Redis', error);
      throw error;
    }
  }

  /**
   * Deletes a value from Redis.
   * @param key - The key to delete.
   */
  public async deleteValue(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
      this.logger.info(`Deleted key from Redis: ${key}`);
    } catch (error) {
      this.logger.error('Error deleting value from Redis', error);
      throw error;
    }
  }
}
