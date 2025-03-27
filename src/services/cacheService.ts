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
      await this.cacheClient.setValue(key, value, ttlSeconds);
    } catch (error) {
      this.logger.error('Error setting value in Redis', error);
      throw error;
    }
  }

  public async getValue<T>(key: string): Promise<T | null> {
    try {
      return await this.cacheClient.getValue(key);
    } catch (error) {
      this.logger.error('Error retrieving value from Redis', error);
      throw error;
    }
  }

  public async deleteValue(key: string): Promise<void> {
    try {
      await this.cacheClient.deleteValue(key);
    } catch (error) {
      this.logger.error('Error deleting value from Redis', error);
      throw error;
    }
  }
}
