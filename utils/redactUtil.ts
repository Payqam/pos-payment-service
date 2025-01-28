import { LoggerService, ToRedact } from '@mu-ts/logger';

// Utility function for creating and registering a redaction filter
export const registerRedactFilter = (sensitiveFields: string[]) => {
  const redactFilter = (toRedact: ToRedact): unknown => {
    if (toRedact.fieldName && sensitiveFields.includes(toRedact.fieldName)) {
      return '>>> REDACTED <<<';
    }
    return toRedact.value;
  };

  // Register the redaction filter with the LoggerService
  LoggerService.registerFilter({
    redact: redactFilter,
  });
};
