import { CacheClient } from '../cacheClient';
import { Logger, LoggerService } from '@mu-ts/logger';
import { EnhancedError, ErrorCategory } from '../../utils/errorHandler';

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
      throw new EnhancedError(
        'CACHE_SET_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to set cache value for key: ${key}`,
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check Redis connectivity and configuration',
        }
      );
    }
  }

  public async getValue<T>(key: string): Promise<T | null> {
    try {
      return await this.cacheClient.getValue(key);
    } catch (error) {
      this.logger.error('Error retrieving value from Redis', error);
      throw new EnhancedError(
        'CACHE_GET_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to get cache value for key: ${key}`,
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check Redis connectivity and configuration',
        }
      );
    }
  }

  public async deleteValue(key: string): Promise<void> {
    try {
      await this.cacheClient.deleteValue(key);
    } catch (error) {
      this.logger.error('Error deleting value from Redis', error);
      throw new EnhancedError(
        'CACHE_DELETE_ERROR',
        ErrorCategory.SYSTEM_ERROR,
        `Failed to delete cache value for key: ${key}`,
        {
          originalError: error,
          retryable: true,
          suggestedAction: 'Check Redis connectivity and configuration',
        }
      );
    }
  }
}
