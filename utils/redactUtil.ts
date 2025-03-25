import { LoggerService, ToRedact } from '@mu-ts/logger';

/**
 * List of fields that should be masked in logs to protect sensitive information
 * This includes credentials, personal identifiable information, and financial data
 */
export const SENSITIVE_FIELDS = [
  // Authentication and credentials
  'apiKey',
  'subscriptionKey',
  'apiUser',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'webhookSecret',
  'authorization',
  'Authorization',
  'x-api-key',
  'X-Api-Key',
  
  // Personal identifiable information
  'mobileNo',
  'partyId',
  'merchantMobileNo',
  'phoneNumber',
  'email',
  'address',
  'name',
  'firstName',
  'lastName',
  'fullName',
  
  // Financial information
  'cardNumber',
  'cvv',
  'expiryDate',
  'accountNumber',
  'iban',
  'pin',
  'securityCode',
  
  // Headers that might contain sensitive data
  'authorization',
  'cookie',
  'x-auth-token'
];

// Utility function for creating and registering a redaction filter
export const registerRedactFilter = (sensitiveFields: string[] = SENSITIVE_FIELDS) => {
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

/**
 * Masks sensitive values in a string (e.g., for log messages)
 * Useful for masking values that aren't automatically caught by the redaction filter
 * 
 * @param value - The string value to mask
 * @param maskChar - Character to use for masking (default: '*')
 * @param visibleChars - Number of characters to leave visible at start and end (default: 4)
 * @returns The masked string
 */
export const maskSensitiveValue = (
  value: string,
  maskChar = '*',
  visibleChars = 4
): string => {
  if (!value || value.length <= visibleChars * 2) {
    return value;
  }
  
  const prefix = value.substring(0, visibleChars);
  const suffix = value.substring(value.length - visibleChars);
  const maskedPortion = maskChar.repeat(Math.min(value.length - visibleChars * 2, 8));
  
  return `${prefix}${maskedPortion}${suffix}`;
};

/**
 * Masks a mobile number for logging purposes
 * 
 * @param mobileNo - The mobile number to mask
 * @returns The masked mobile number
 */
export const maskMobileNumber = (mobileNo: string): string => {
  if (!mobileNo || mobileNo.length < 8) {
    return '>>> REDACTED <<<';
  }
  
  // Keep first 3 and last 2 digits visible
  const prefix = mobileNo.substring(0, 3);
  const suffix = mobileNo.substring(mobileNo.length - 2);
  const maskedPortion = '*'.repeat(mobileNo.length - 5);
  
  return `${prefix}${maskedPortion}${suffix}`;
};
