/**
 * MTN MoMo API Error Types and Interfaces
 */

export enum MTNRequestToPayErrorCode {
  PAYER_FAILED = 'RequestToPayPayerFailed',
  PAYER_REJECTED = 'RequestToPayPayerRejected',
  PAYER_EXPIRED = 'RequestToPayPayerExpired',
  PAYER_ONGOING = 'RequestToPayPayerOngoing',
  PAYER_DELAYED = 'RequestToPayPayerDelayed',
  PAYER_NOT_FOUND = 'RequestToPayPayerNotFound',
  PAYER_NOT_ALLOWED_TO_RECEIVE = 'RequestToPayPayerNotAllowedToReceive',
  PAYER_NOT_ALLOWED = 'RequestToPayPayerNotAllowed',
  PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT = 'RequestToPayPayerNotAllowedTargetEnvironment',
  PAYER_INVALID_CALLBACK_URL_HOST = 'RequestToPayPayerInvalidCallbackUrlHost',
  PAYER_INVALID_CURRENCY = 'RequestToPayPayerInvalidCurrency',
  PAYER_SERVICE_UNAVAILABLE = 'RequestToPayPayerServiceUnavailable',
  PAYER_COULD_NOT_PERFORM_TRANSACTION = 'RequestToPayPayerCouldNotPerformTransaction',
  PAYER_INTERNAL_PROCESSING_ERROR = 'RequestToPayPayerInternalProcessingError',
}

export interface MTNErrorResponse {
  statusCode: number;
  errorCode: string;
  label: string;
  message: string;
  details: {
    transactionId: string;
    timestamp: string;
    retryable: boolean;
    suggestedAction: string;
  };
}

export interface MTNErrorMapping {
  label: string;
  message: string;
  statusCode: number;
  retryable: boolean;
  suggestedAction: string;
}

/**
 * Maps MTN error codes to their corresponding error details
 */
export const MTN_ERROR_MAPPINGS: Record<string, MTNErrorMapping> = {
  [MTNRequestToPayErrorCode.PAYER_FAILED]: {
    label: 'PayerFailed',
    message:
      "The transaction failed due to an issue with the payer's account or wallet balance.",
    statusCode: 400,
    retryable: false,
    suggestedAction:
      'Notify the payer of the failure and suggest verifying their wallet balance or account status.',
  },
  [MTNRequestToPayErrorCode.PAYER_REJECTED]: {
    label: 'PayerRejected',
    message: 'The payer explicitly rejected the payment request.',
    statusCode: 400,
    retryable: true,
    suggestedAction:
      'Inform the user about rejection and allow them to retry if necessary.',
  },
  [MTNRequestToPayErrorCode.PAYER_EXPIRED]: {
    label: 'PayerExpired',
    message:
      'The payer did not respond within the allowed time frame (e.g., OTP expired).',
    statusCode: 408,
    retryable: true,
    suggestedAction:
      'Notify the user about expiration and initiate a new payment request if required.',
  },
  [MTNRequestToPayErrorCode.PAYER_ONGOING]: {
    label: 'PayerOngoing',
    message:
      "The payment request is still being processed by MTN's system or awaiting user action.",
    statusCode: 202,
    retryable: true,
    suggestedAction:
      'Wait and poll for updates using the status-check endpoint after a short delay.',
  },
  [MTNRequestToPayErrorCode.PAYER_DELAYED]: {
    label: 'PayerDelayed',
    message:
      'The transaction is delayed due to network congestion or processing delays.',
    statusCode: 503,
    retryable: true,
    suggestedAction:
      'Notify the user about the delay and retry status checks periodically until resolved.',
  },
  [MTNRequestToPayErrorCode.PAYER_NOT_FOUND]: {
    label: 'PayerNotFound',
    message: "The payer's MSISDN is invalid or unregistered.",
    statusCode: 404,
    retryable: false,
    suggestedAction:
      'Verify that the MSISDN includes a valid country code and retry with corrected details.',
  },
  [MTNRequestToPayErrorCode.PAYER_NOT_ALLOWED_TO_RECEIVE]: {
    label: 'PayerNotAllowedToReceive',
    message:
      'The payer is restricted from receiving payments due to account limitations.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions or suggest alternatives.',
  },
  [MTNRequestToPayErrorCode.PAYER_SERVICE_UNAVAILABLE]: {
    label: 'ServiceUnavailable',
    message: "MTN's service is temporarily unavailable.",
    statusCode: 503,
    retryable: true,
    suggestedAction:
      'Retry after a delay; notify users of potential downtime if retries fail consistently.',
  },
  [MTNRequestToPayErrorCode.PAYER_INTERNAL_PROCESSING_ERROR]: {
    label: 'InternalProcessingError',
    message:
      "A generic error occurred due to internal issues on MTN's platform.",
    statusCode: 500,
    retryable: true,
    suggestedAction:
      'Retry with exponential backoff; if persistent, contact MTN support for investigation.',
  },
};
