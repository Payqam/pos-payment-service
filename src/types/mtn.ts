export enum MTNRequestToPayErrorReason {
  FAILED = 'PAYER_FAILED',
  REJECTED = 'APPROVAL_REJECTED',
  EXPIRED = 'EXPIRED',
  ONGOING = 'PAYER_ONGOING',
  DELAYED = 'PAYER_DELAYED',
  NOT_FOUND = 'PAYER_NOT_FOUND',
  NOT_ALLOWED_TO_RECEIVE = 'PAYEE_NOT_ALLOWED_TO_RECEIVE',
  NOT_ALLOWED = 'NOT_ALLOWED',
  NOT_ALLOWED_TARGET_ENVIRONMENT = 'NOT_ALLOWED_TARGET_ENVIRONMENT',
  INVALID_CALLBACK_URL_HOST = 'INVALID_CALLBACK_URL_HOST',
  INVALID_CURRENCY = 'INVALID_CURRENCY',
  INTERNAL_PROCESSING_ERROR = 'INTERNAL_PROCESSING_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  COULD_NOT_PERFORM_TRANSACTION = 'COULD_NOT_PERFORM_TRANSACTION',
}
export enum MTNTransferErrorReason {
  FAILED = 'PAYER_FAILED',
  REJECTED = 'APPROVAL_REJECTED',
  EXPIRED = 'EXPIRED',
  ONGOING = 'PAYER_ONGOING',
  DELAYED = 'PAYER_DELAYED',
  NOT_ENOUGH_FUNDS = 'NOT_ENOUGH_FUNDS',
  LIMIT_REACHED = 'PAYER_LIMIT_REACHED',
  NOT_FOUND = 'PAYEE_NOT_FOUND',
  NOT_ALLOWED = 'NOT_ALLOWED',
  NOT_ALLOWED_TARGET_ENVIRONMENT = 'NOT_ALLOWED_TARGET_ENVIRONMENT',
  INVALID_CALLBACK_URL_HOST = 'INVALID_CALLBACK_URL_HOST',
  INVALID_CURRENCY = 'INVALID_CURRENCY',
  INTERNAL_PROCESSING_ERROR = 'INTERNAL_PROCESSING_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export interface MTNErrorMapping {
  label: string;
  message: string;
  statusCode: number;
  retryable: boolean;
  suggestedAction: string;
}

export const MTN_REQUEST_TO_PAY_ERROR_MAPPINGS: Record<
  string,
  MTNErrorMapping
> = {
  [MTNRequestToPayErrorReason.FAILED]: {
    label: 'PayerFailed',
    message:
      "The transaction failed due to an issue with the payer's account or wallet balance.",
    statusCode: 400,
    retryable: false,
    suggestedAction:
      'Notify the payer of the failure and suggest verifying their wallet balance or account status.',
  },
  [MTNRequestToPayErrorReason.REJECTED]: {
    label: 'PayerRejected',
    message: 'The payer explicitly rejected the payment request.',
    statusCode: 400,
    retryable: false, // Set  to false for now
    suggestedAction: 'Inform the payer about rejection.',
  },
  [MTNRequestToPayErrorReason.EXPIRED]: {
    label: 'PayerExpired',
    message:
      'The payer did not respond within the allowed time frame (e.g., OTP expired).',
    statusCode: 408,
    retryable: false, // Set  to false for now
    suggestedAction: 'Notify the payer about the expiration',
  },
  [MTNRequestToPayErrorReason.ONGOING]: {
    label: 'PayerOngoing',
    message:
      "The payment request is still being processed by MTN's system or awaiting user action.",
    statusCode: 202,
    retryable: false, // Set  to false for now
    suggestedAction:
      'Wait and poll for updates using the status-check endpoint after a short delay.',
  },
  [MTNRequestToPayErrorReason.DELAYED]: {
    label: 'PayerDelayed',
    message:
      'The transaction is delayed due to network congestion or processing delays.',
    statusCode: 503,
    retryable: false, // Set  to false for now
    suggestedAction:
      'Notify the payer about the delay and retry status checks periodically until resolved.',
  },
  [MTNRequestToPayErrorReason.NOT_FOUND]: {
    label: 'PayerNotFound',
    message: "The payer's MSISDN is invalid or unregistered.",
    statusCode: 404,
    retryable: false,
    suggestedAction:
      'Verify that the MSISDN includes a valid country code and retry with corrected details.',
  },
  [MTNRequestToPayErrorReason.NOT_ALLOWED_TO_RECEIVE]: {
    label: 'PayerNotAllowedToReceive',
    message:
      'The payer is restricted from receiving payments due to account limitations.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions or suggest alternatives.',
  },
  [MTNRequestToPayErrorReason.NOT_ALLOWED]: {
    label: 'RequestToPayPayerNotAllowed',
    message: 'The payer is restricted from receiving payments.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions.',
  },
  [MTNRequestToPayErrorReason.NOT_ALLOWED_TARGET_ENVIRONMENT]: {
    label: 'RequestToPayPayerNotAllowedTargetEnvironment',
    message: 'The payer is restricted in the target environment.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions.',
  },
  [MTNRequestToPayErrorReason.INVALID_CALLBACK_URL_HOST]: {
    label: 'RequestToPayPayerInvalidCallbackUrlHost',
    message: 'Invalid callback url is provided or configured.',
    statusCode: 403,
    retryable: false,
    suggestedAction: 'Contact MTN developer support for clarification.',
  },
  [MTNRequestToPayErrorReason.INVALID_CURRENCY]: {
    label: 'RequestToPayPayerInvalidCurrency',
    message: 'Invalid currency is configured.',
    statusCode: 403,
    retryable: false,
    suggestedAction: 'Contact MTN developer support for clarification.',
  },
  [MTNRequestToPayErrorReason.SERVICE_UNAVAILABLE]: {
    label: 'RequestToPayPayerServiceUnavailable',
    message: "MTN's service is temporarily unavailable.",
    statusCode: 503,
    retryable: false, // Set  to false for now
    suggestedAction:
      'Notify payer of potential downtime if retries fail consistently.',
  },
  [MTNRequestToPayErrorReason.INTERNAL_PROCESSING_ERROR]: {
    label: 'RequestToPayPayerInternalProcessingError',
    message:
      "A generic error occurred due to internal issues on MTN's platform.",
    statusCode: 500,
    retryable: false, // Set  to false for now
    suggestedAction: 'If persistent, contact MTN support for investigation.',
  },
  [MTNRequestToPayErrorReason.COULD_NOT_PERFORM_TRANSACTION]: {
    label: 'RequestToPayPayerCouldNotPerformTransaction',
    message: 'Could not perform the transaction.',
    statusCode: 500,
    retryable: false, // Set  to false for now
    suggestedAction: 'If persistent, contact MTN support for investigation.',
  },
};
export const MTN_TRANSFER_ERROR_MAPPINGS: Record<string, MTNErrorMapping> = {
  [MTNTransferErrorReason.FAILED]: {
    label: 'TransferPayeeFailed',
    message: "The transaction failed due to an issue with the payee's account.",
    statusCode: 400,
    retryable: false,
    suggestedAction:
      'Notify the payee of the failure and suggest verifying their account status.',
  },
  [MTNTransferErrorReason.REJECTED]: {
    label: 'TransferPayeeRejected',
    message: 'The payee explicitly rejected the transfer request.',
    statusCode: 400,
    retryable: false, // Set  to false for now
    suggestedAction: 'Inform the payee about the rejection.',
  },
  [MTNTransferErrorReason.EXPIRED]: {
    label: 'TransferPayeeExpired',
    message: 'The payee did not respond within the allowed time frame.',
    statusCode: 408,
    retryable: false, // Set  to false for now
    suggestedAction: 'Notify the payee about expiration.',
  },
  [MTNTransferErrorReason.ONGOING]: {
    label: 'TransferPayeeOngoing',
    message:
      "The transfer request is still being processed by MTN's system or awaiting user action.",
    statusCode: 202,
    retryable: false, // Set  to false for now
    suggestedAction:
      'Wait and poll for updates using the status-check endpoint after a short delay.',
  },
  [MTNTransferErrorReason.DELAYED]: {
    label: 'TransferPayeeDelayed',
    message:
      'The transaction is delayed due to network congestion or processing delays.',
    statusCode: 503,
    retryable: false, // Set  to false for now
    suggestedAction:
      'Notify the payee about the delay and retry status checks periodically until resolved.',
  },
  [MTNTransferErrorReason.NOT_ENOUGH_FUNDS]: {
    label: 'TransferPayeeNotEnoughFunds',
    message: 'No enough founds in the payer account.',
    statusCode: 503,
    retryable: false, // Set  to false for now
    suggestedAction: 'Top up the account balance and retry.',
  },
  [MTNTransferErrorReason.LIMIT_REACHED]: {
    label: 'TransferPayeePayerLimitReached',
    message: 'Daily limit is reached in the payer account.',
    statusCode: 503,
    retryable: false, // Set  to false for now
    suggestedAction: 'You can try again next day.',
  },
  [MTNTransferErrorReason.NOT_FOUND]: {
    label: 'TransferPayeeNotFound',
    message: "The payee's MSISDN is invalid or unregistered.",
    statusCode: 404,
    retryable: false,
    suggestedAction:
      'Verify that the MSISDN includes a valid country code and retry with corrected details.',
  },
  [MTNTransferErrorReason.NOT_ALLOWED]: {
    label: 'TransferPayeeNotAllowed',
    message: 'Not allowed to transfer to the payee account.',
    statusCode: 404,
    retryable: false,
    suggestedAction: 'Notify the payee about the error',
  },
  [MTNTransferErrorReason.NOT_ALLOWED_TARGET_ENVIRONMENT]: {
    label: 'TransferPayeeNotAllowedTargetEnvironment',
    message: 'The payee is restricted in the target environment.',
    statusCode: 403,
    retryable: false,
    suggestedAction:
      'Contact MTN support for clarification on account restrictions.',
  },
  [MTNTransferErrorReason.INVALID_CALLBACK_URL_HOST]: {
    label: 'TransferPayeeInvalidCallbackUrlHost',
    message: 'Invalid callback url is provided or configured',
    statusCode: 403,
    retryable: false,
    suggestedAction: 'Contact MTN developer support for clarification.',
  },
  [MTNTransferErrorReason.INVALID_CURRENCY]: {
    label: 'TransferPayeeInvalidCurrency',
    message: 'Invalid currency is configured for the payee.',
    statusCode: 403,
    retryable: false,
    suggestedAction: 'Contact MTN developer support for clarification.',
  },
  [MTNTransferErrorReason.INTERNAL_PROCESSING_ERROR]: {
    label: 'TransferPayeeInternalProcessingError',
    message:
      "A generic error occurred due to internal issues on MTN's platform.",
    statusCode: 500,
    retryable: false, // Set  to false for now
    suggestedAction: 'If persistent, contact MTN support for investigation.',
  },
  [MTNTransferErrorReason.SERVICE_UNAVAILABLE]: {
    label: 'TransferPayeeServiceUnavailable',
    message: "MTN's service is temporarily unavailable.",
    statusCode: 503,
    retryable: false, // Set  to false for now
    suggestedAction:
      'Notify payee of potential downtime if retries fail consistently.',
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
  payee: Party;
  payerMessage?: string;
  payeeNote?: string;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  reason?: string;
}
