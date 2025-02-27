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
  PAYER_INTERNAL_PROCESSING_ERROR = 'RequestToPayPayerInternalProcessingError',
  PAYER_SERVICE_UNAVAILABLE = 'RequestToPayPayerServiceUnavailable',
  PAYER_COULD_NOT_PERFORM_TRANSACTION = 'RequestToPayPayerCouldNotPerformTransaction',
}

export enum MTNRequestToPayErrorReason {
  PAYER_FAILED = 'PAYER_FAILED', //"status": "FAILED","reason": "INTERNAL_PROCESSING_ERROR"
  PAYER_REJECTED = 'APPROVAL_REJECTED', //  "status": "FAILED","reason": "APPROVAL_REJECTED"
  PAYER_EXPIRED = 'EXPIRED', //    "status": "FAILED","reason": "EXPIRED"
  PAYER_ONGOING = 'PAYER_ONGOING', //  "status": "PENDING" , retriable
  PAYER_DELAYED = 'PAYER_DELAYED', //  "status": "PENDING" , retriable
  PAYER_NOT_FOUND = 'PAYER_NOT_FOUND', //  "status": "FAILED","reason": "PAYER_NOT_FOUND"
  PAYER_NOT_ALLOWED_TO_RECEIVE = 'PAYEE_NOT_ALLOWED_TO_RECEIVE', //"status": "FAILED", "reason": "PAYEE_NOT_ALLOWED_TO_RECEIVE"
  PAYER_NOT_ALLOWED = 'NOT_ALLOWED', //  "status": "FAILED","reason": "NOT_ALLOWED"
  PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT = 'NOT_ALLOWED_TARGET_ENVIRONMENT', // "status": "FAILED","reason": "NOT_ALLOWED_TARGET_ENVIRONMENT"
  PAYER_INVALID_CALLBACK_URL_HOST = 'INVALID_CALLBACK_URL_HOST', //"status": "FAILED","reason": "INVALID_CALLBACK_URL_HOST"
  PAYER_INVALID_CURRENCY = 'INVALID_CURRENCY', // "status": "FAILED","reason": "INVALID_CURRENCY"
  PAYER_INTERNAL_PROCESSING_ERROR = 'INTERNAL_PROCESSING_ERROR', // "status": "FAILED","reason": "INTERNAL_PROCESSING_ERROR"
  PAYER_SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE', //"status": "FAILED","reason": "SERVICE_UNAVAILABLE"
  PAYER_COULD_NOT_PERFORM_TRANSACTION = 'COULD_NOT_PERFORM_TRANSACTION', //  "status": "FAILED","reason": "COULD_NOT_PERFORM_TRANSACTION"
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
    label: 'RequestToPayPayerFailed',
    message:
      "The transaction failed due to an issue with the payer's account or wallet balance.",
    statusCode: 400,
    retryable: false,
    suggestedAction:
      'Notify the payer of the failure and suggest verifying their wallet balance or account status.',
  },
  [MTNRequestToPayErrorCode.PAYER_REJECTED]: {
    label: 'RequestToPayPayerRejected',
    message: 'The payer explicitly rejected the payment request.',
    statusCode: 400,
    retryable: true,
    suggestedAction:
      'Inform the user about rejection and allow them to retry if necessary.',
  },
  [MTNRequestToPayErrorCode.PAYER_EXPIRED]: {
    label: 'RequestToPayPayerExpired',
    message:
      'The payer did not respond within the allowed time frame (e.g., OTP expired).',
    statusCode: 408,
    retryable: true,
    suggestedAction:
      'Notify the user about expiration and initiate a new payment request if required.',
  },
  [MTNRequestToPayErrorCode.PAYER_NOT_FOUND]: {
    label: 'RequestToPayPayerNotFound',
    message: "The payer's MSISDN is invalid or unregistered.",
    statusCode: 404,
    retryable: false,
    suggestedAction:
      'Verify that the MSISDN includes a valid country code and retry with corrected details.',
  },
  [MTNRequestToPayErrorCode.PAYER_NOT_ALLOWED_TO_RECEIVE]: {
    label: 'RequestToPayPayerNotAllowedToReceive',
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
      'Retry after a delay; if persistent, contact MTN support for investigation.',
  },
};

export const MTN_REQUEST_TO_PAY_ERROR_MAPPINGS: Record<
  string,
  MTNErrorMapping
> = {
  [MTNRequestToPayErrorReason.PAYER_FAILED]: {
    label: 'PayerFailed',
    message:
      "The transaction failed due to an issue with the payer's account or wallet balance.",
    statusCode: 400,
    retryable: false,
    suggestedAction:
      'Notify the payer of the failure and suggest verifying their wallet balance or account status.',
  },
  [MTNRequestToPayErrorReason.PAYER_REJECTED]: {
    label: 'PayerRejected',
    message: 'The payer explicitly rejected the payment request.',
    statusCode: 400,
    retryable: true,
    suggestedAction:
      'Inform the user about rejection and allow them to retry if necessary.',
  },
  [MTNRequestToPayErrorReason.PAYER_EXPIRED]: {
    label: 'PayerExpired',
    message:
      'The payer did not respond within the allowed time frame (e.g., OTP expired).',
    statusCode: 408,
    retryable: true,
    suggestedAction:
      'Notify the user about expiration and initiate a new payment request if required.',
  },
  [MTNRequestToPayErrorReason.PAYER_ONGOING]: {
    label: 'PayerOngoing',
    message:
      "The payment request is still being processed by MTN's system or awaiting user action.",
    statusCode: 202,
    retryable: true,
    suggestedAction:
      'Wait and poll for updates using the status-check endpoint after a short delay.',
  },
  [MTNRequestToPayErrorReason.PAYER_DELAYED]: {
    label: 'PayerDelayed',
    message:
      'The transaction is delayed due to network congestion or processing delays.',
    statusCode: 503,
    retryable: true,
    suggestedAction:
      'Notify the user about the delay and retry status checks periodically until resolved.',
  },
  [MTNRequestToPayErrorReason.PAYER_NOT_FOUND]: {
    label: 'PayerNotFound',
    message: "The payer's MSISDN is invalid or unregistered.",
    statusCode: 404,
    retryable: false,
    suggestedAction:
      'Verify that the MSISDN includes a valid country code and retry with corrected details.',
  },
  [MTNRequestToPayErrorReason.PAYER_NOT_ALLOWED_TO_RECEIVE]: {
    label: 'PayerNotAllowedToReceive',
    message:
      'The payer is restricted from receiving payments due to account limitations.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions or suggest alternatives.',
  },
  [MTNRequestToPayErrorReason.PAYER_NOT_ALLOWED]: {
    label: 'RequestToPayPayerNotAllowed',
    message: 'The payer is restricted from receiving payments.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions.',
  },
  [MTNRequestToPayErrorReason.PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT]: {
    label: 'RequestToPayPayerNotAllowedTargetEnvironment',
    message: 'The payer is restricted in the target environment.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions.',
  },
  [MTNRequestToPayErrorReason.PAYER_INVALID_CALLBACK_URL_HOST]: {
    label: 'RequestToPayPayerInvalidCallbackUrlHost',
    message: 'Invalid callback url is provided or configured',
    statusCode: 403,
    retryable: false,
    suggestedAction: 'Contact MTN developer support for clarification.',
  },
  [MTNRequestToPayErrorReason.PAYER_INVALID_CURRENCY]: {
    label: 'PAYER_INVALID_CURRENCY',
    message: 'Invalid currency is configured',
    statusCode: 403,
    retryable: false,
    suggestedAction: 'Contact MTN developer support for clarification.',
  },
  [MTNRequestToPayErrorReason.PAYER_SERVICE_UNAVAILABLE]: {
    label: 'ServiceUnavailable',
    message: "MTN's service is temporarily unavailable.",
    statusCode: 503,
    retryable: true,
    suggestedAction:
      'Retry after a delay; notify users of potential downtime if retries fail consistently.',
  },
  [MTNRequestToPayErrorReason.PAYER_INTERNAL_PROCESSING_ERROR]: {
    label: 'InternalProcessingError',
    message:
      "A generic error occurred due to internal issues on MTN's platform.",
    statusCode: 500,
    retryable: true,
    suggestedAction:
      'Retry with exponential backoff; if persistent, contact MTN support for investigation.',
  },
  [MTNRequestToPayErrorReason.PAYER_COULD_NOT_PERFORM_TRANSACTION]: {
    label: 'RequestToPayPayerCouldNotPerformTransaction',
    message: 'Could not perform the transaction.',
    statusCode: 500,
    retryable: true,
    suggestedAction:
      'Retry after a delay; if persistent, contact MTN support for investigation.',
  },
};

interface Party {
  partyIdType: string;
  partyId: string;
}
export interface WebhookEvent {
  financialTransactionId: string;
  externalId: string;
  amount: string;
  currency: string;
  payer: Party;
  payerMessage?: string;
  payeeNote?: string;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  reason?: string;
}
