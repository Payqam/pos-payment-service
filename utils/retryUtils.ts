import { Logger } from '@mu-ts/logger';
import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { EnhancedError, ErrorCategory } from './errorHandler';

/**
 * Configuration options for the retry mechanism
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Whether to respect Retry-After header if present */
  respectRetryAfter: boolean;
  /** Logger instance */
  logger: Logger;
  /** Custom function to determine if an error is retryable */
  isRetryable?: (error: any) => boolean;
  /** Alternative to isRetryable - more descriptive name */
  shouldRetry?: (error: any) => boolean;
  /** Custom function to calculate delay between retries */
  calculateDelay?: (attempt: number, error: any) => number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 100,
  maxDelayMs: 30000, // 30 seconds max delay
  respectRetryAfter: true,
  logger: console as any,
};

/**
 * Determines if an error is retryable based on its status code or error type
 *
 * @param error - The error to check
 * @returns True if the error is retryable, false otherwise
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  // Check if it's an Axios error
  if (error.isAxiosError) {
    const status = error.response?.status;
    // Retry on rate limiting, server errors, and network errors
    return (
      status === 429 || // Too Many Requests
      (status && status >= 500 && status < 600) || // Server errors
      !status // Network errors (no response)
    );
  }

  // Check for specific AWS error types that are retryable
  const retryableErrors = [
    'ThrottlingException',
    'LimitExceededException',
    'ProvisionedThroughputExceededException',
    'RequestLimitExceeded',
    'TooManyRequestsException',
    'NetworkingError',
    'ConnectionError',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
  ];

  return retryableErrors.includes(error.name || error.code);
}

/**
 * Calculates the backoff delay for a retry attempt with jitter
 *
 * @param attempt - The current attempt number (0-based)
 * @param config - Retry configuration
 * @param retryAfter - Optional Retry-After header value in seconds
 * @returns The delay in milliseconds before the next retry
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig,
  retryAfter?: number
): number {
  // If Retry-After header is present and we respect it, use that value
  if (config.respectRetryAfter && retryAfter && !isNaN(retryAfter)) {
    return Math.min(retryAfter * 1000, config.maxDelayMs);
  }

  // Exponential backoff with full jitter
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponentialDelay;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Sleeps for a given number of milliseconds
 *
 * @param ms - The number of milliseconds to sleep
 * @returns A promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a function with exponential backoff retry logic
 *
 * @param operation - The async function to execute with retry logic
 * @param config - Retry configuration
 * @param operationName - Name of the operation for logging
 * @param errorCode - Error code to use when throwing an enhanced error
 * @param errorCategory - Error category to use when throwing an enhanced error
 * @param errorMessage - Error message to use when throwing an enhanced error
 * @param metadata - Additional metadata to include in the error
 * @returns The result of the operation
 * @throws EnhancedError if all retries fail
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  operationName: string = 'API operation',
  errorCode: string = 'OPERATION_FAILED',
  errorCategory: ErrorCategory = ErrorCategory.PROVIDER_ERROR,
  errorMessage: string = 'Operation failed after multiple retries',
  metadata: Record<string, any> = {}
): Promise<T> {
  // Use shouldRetry if provided, otherwise fall back to isRetryable, or default to isRetryableError
  const isRetryableFn =
    config.shouldRetry || config.isRetryable || isRetryableError;
  let lastError: any;
  let attempt = 0;

  while (attempt < config.maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Check if we should retry
      if (!isRetryableFn(error) || attempt === config.maxRetries - 1) {
        break;
      }

      // Get retry-after header if available
      let retryAfter: number | undefined;
      if (error.isAxiosError && error.response?.headers['retry-after']) {
        retryAfter = parseInt(error.response.headers['retry-after'], 10);
      }

      // Calculate delay - use custom function if provided
      let delay: number;
      if (config.calculateDelay) {
        delay = config.calculateDelay(attempt, error);
      } else {
        delay = calculateBackoffDelay(attempt, config, retryAfter);
      }

      // Log retry attempt
      config.logger.warn(
        `${operationName} failed (attempt ${attempt + 1}/${config.maxRetries}). Retrying after ${delay}ms.`,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          delay,
          retryAfter,
          ...(error.isAxiosError
            ? {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
              }
            : {}),
          ...metadata,
        }
      );

      // Wait before retrying
      await sleep(delay);
      attempt++;
    }
  }

  // If we got here, all retries failed
  config.logger.error(
    `${operationName} failed after ${config.maxRetries} attempts`,
    {
      error: lastError instanceof Error ? lastError.message : 'Unknown error',
      ...metadata,
    }
  );

  // Enhance the error with additional context
  throw new EnhancedError(errorCode, errorCategory, errorMessage, {
    originalError: lastError,
    retryable: false, // We've already retried
    suggestedAction:
      'Please try again later or contact support if the issue persists',
    ...metadata,
  });
}

/**
 * Creates an Axios instance with retry capability
 *
 * @param axiosInstance - The Axios instance to enhance with retry capability
 * @param config - Retry configuration
 * @returns The enhanced Axios instance
 */
export function createRetryableAxiosInstance(
  axiosInstance: AxiosInstance,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): AxiosInstance {
  // Store the original request method
  const originalRequest = axiosInstance.request;

  // Override the request method with retry logic
  axiosInstance.request = async function <T = any, R = AxiosResponse<T>>(
    configOrUrl: string | AxiosRequestConfig
  ): Promise<R> {
    const requestConfig =
      typeof configOrUrl === 'string' ? { url: configOrUrl } : configOrUrl;

    return executeWithRetry<R>(
      () => originalRequest.call(axiosInstance, requestConfig) as Promise<R>,
      config,
      `Axios request to ${requestConfig.url || 'unknown endpoint'}`,
      'API_REQUEST_FAILED',
      ErrorCategory.PROVIDER_ERROR,
      'API request failed after multiple retries',
      {
        method: requestConfig.method || 'GET',
        url: requestConfig.url,
        baseURL: axiosInstance.defaults.baseURL,
      }
    );
  };

  return axiosInstance;
}
