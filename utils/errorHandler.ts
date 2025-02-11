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
  details?: string;
}

/**
 * Custom error class with category support
 */
export class EnhancedError extends Error {
  public readonly category: ErrorCategory;

  public readonly errorCode: string;

  public readonly details?: string;

  constructor(
    errorCode: string,
    category: ErrorCategory,
    message: string,
    details?: string
  ) {
    super(message);
    this.errorCode = errorCode;
    this.category = category;
    this.details = details;
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
  private static getStatusCode(category: ErrorCategory): number {
    const statusMap: Record<ErrorCategory, number> = {
      [ErrorCategory.VALIDATION_ERROR]: 400,
      [ErrorCategory.PROVIDER_ERROR]: 502,
      [ErrorCategory.SYSTEM_ERROR]: 500,
    };
    return statusMap[category] || 500;
  }

  /**
   * Creates a structured error response
   * @param errorCode - Unique error code
   * @param error - Error category
   * @param message - Error message
   * @param details - Additional error details (optional)
   * @returns APIGatewayProxyResult
   */
  public static createErrorResponse(
    errorCode: string,
    error: ErrorCategory,
    message: string,
    details?: string
  ): APIGatewayProxyResult {
    const errorResponse: ErrorResponse = { errorCode, error, message, details };

    return {
      statusCode: this.getStatusCode(error),
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify(errorResponse),
    };
  }

  /**
   * Handles exceptions and returns a structured error response
   * @param error - The thrown exception
   * @param defaultMessage - Default message when no specific error is available
   * @returns APIGatewayProxyResult
   */
  public static handleException(
    error: unknown,
    defaultMessage: string
  ): APIGatewayProxyResult {
    this.logger.error('Error occurred:', error);

    if (error instanceof EnhancedError) {
      return this.createErrorResponse(
        error.errorCode,
        error.category,
        error.message,
        error.details
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return this.createErrorResponse(
      'UNEXPECTED_ERROR',
      ErrorCategory.SYSTEM_ERROR,
      defaultMessage,
      errorMessage
    );
  }
}
