import { APIGatewayProxyResult } from 'aws-lambda';
import { API } from '../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';

/**
 * Error categories for different types of errors
 */
export enum ErrorCategory {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
}

/**
 * Error response interface
 */
export interface ErrorResponse {
  errorCode: string;
  error: ErrorCategory;
  message: string;
  retryable?: boolean;
  suggestedAction?: string;
  httpStatus?: number;
  details?: unknown;
}

/**
 * Additional error metadata interface
 */
export interface ErrorMetadata {
  retryable?: boolean;
  suggestedAction?: string;
  originalError?: unknown;
  httpStatus?: number;
}

/**
 * Custom error class with enhanced error information
 */
export class EnhancedError extends Error {
  public readonly category: ErrorCategory;

  public readonly errorCode: string;

  public readonly retryable: boolean;

  public readonly suggestedAction?: string;

  public readonly originalError?: unknown;

  public readonly httpStatus?: number;

  constructor(
    errorCode: string,
    category: ErrorCategory,
    message: string,
    metadata?: ErrorMetadata
  ) {
    super(message);
    this.name = 'EnhancedError';
    this.errorCode = errorCode;
    this.category = category;
    this.retryable = metadata?.retryable ?? false;
    this.suggestedAction = metadata?.suggestedAction;
    this.originalError = metadata?.originalError;
    this.httpStatus = metadata?.httpStatus;
  }
}

/**
 * Error handler class
 */
export class ErrorHandler {
  private static logger: Logger = LoggerService.named('ErrorHandler');

  /**
   * Maps error categories to HTTP status codes
   */
  private static getStatusCode(
    category: ErrorCategory,
    httpStatus?: number
  ): number {
    if (httpStatus) return httpStatus;

    const statusMap: Record<ErrorCategory, number> = {
      [ErrorCategory.VALIDATION_ERROR]: 400,
      [ErrorCategory.PROVIDER_ERROR]: 502,
      [ErrorCategory.SYSTEM_ERROR]: 500,
    };
    return statusMap[category] || 500;
  }

  /**
   * Creates a structured error response
   */
  public static createErrorResponse(
    errorCode: string,
    error: ErrorCategory,
    message: string,
    metadata?: ErrorMetadata
  ): APIGatewayProxyResult {
    const errorResponse: ErrorResponse = {
      errorCode,
      error,
      message,
      retryable: metadata?.retryable ?? false,
      suggestedAction: metadata?.suggestedAction,
      httpStatus: metadata?.httpStatus,
    };

    return {
      statusCode: this.getStatusCode(error, metadata?.httpStatus),
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify(errorResponse),
    };
  }

  /**
   * Safely extracts key information from an error object without circular references
   */
  private static getSafeErrorInfo(error: unknown): Record<string, unknown> {
    if (error instanceof EnhancedError) {
      return {
        name: error.name,
        message: error.message,
        errorCode: error.errorCode,
        category: error.category,
        retryable: error.retryable,
        suggestedAction: error.suggestedAction,
        httpStatus: error.httpStatus,
        stack: error.stack,
      };
    }
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return { error: String(error) };
  }

  /**
   * Handles exceptions and creates appropriate error responses
   */
  public static handleException(
    error: unknown,
    defaultMessage = 'An unexpected error occurred'
  ): APIGatewayProxyResult {
    this.logger.error('Error caught:', this.getSafeErrorInfo(error));

    if (error instanceof EnhancedError) {
      return this.createErrorResponse(
        error.errorCode,
        error.category,
        error.message,
        {
          retryable: error.retryable,
          suggestedAction: error.suggestedAction,
          httpStatus: error.httpStatus,
        }
      );
    }

    return this.createErrorResponse(
      'SYSTEM_ERROR',
      ErrorCategory.SYSTEM_ERROR,
      defaultMessage,
      {
        retryable: false,
        suggestedAction:
          'Please try again later or contact support if the issue persists',
      }
    );
  }
}
