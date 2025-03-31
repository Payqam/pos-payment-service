import { CacheClient } from '../cacheClient';
import { Logger, LoggerService } from '@mu-ts/logger';

export class CacheService {
  private readonly cacheClient: CacheClient;

  private readonly logger: Logger;

  constructor() {
    this.cacheClient = CacheClient.getInstance();
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.logger.info('CacheService initialized');
  }

  public async setValue<T>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    try {
      this.logger.debug('Setting value in cache', {
        key,
        ttlSeconds: ttlSeconds || 'default',
      });
      await this.cacheClient.setValue(key, value, ttlSeconds);
      this.logger.debug('Value set in cache successfully', { key });
    } catch (error) {
      this.logger.error('Error setting value in Redis', error);
      throw error;
    }
  }

  public async getValue<T>(key: string): Promise<T | null> {
    try {
      this.logger.debug('Retrieving value from cache', { key });
      const result = await this.cacheClient.getValue<T>(key);
      this.logger.debug('Value retrieval result', {
        key,
        found: result !== null,
      });
      return result;
    } catch (error) {
      this.logger.error('Error retrieving value from Redis', error);
      throw error;
    }
  }

  public async deleteValue(key: string): Promise<void> {
    try {
      this.logger.debug('Deleting value from cache', { key });
      await this.cacheClient.deleteValue(key);
      this.logger.debug('Value deleted from cache successfully', { key });
    } catch (error) {
      this.logger.error('Error deleting value from Redis', error);
      throw error;
    }
  }
}
