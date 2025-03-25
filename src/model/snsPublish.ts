export interface SalesforceCredentials {
  clientSecret: string;
  clientId: string;
  ownerId: string;
  username: string;
  password: string;
  host: string;
}
export interface SNSMessage {
  transactionId: string;
  status: string;
  merchantId?: string;
  merchantMobileNo?: string;
  transactionType?: 'CHARGE' | 'REFUND';
  metaData?: Record<string, string>;
  fee?: string;
  customerPhone?: string;
  createdOn?: string;
  currency?: string;
  exchangeRate?: string;
  processingFee?: string;
  netAmount?: string;
  settlementAmount?: string;
  externalTransactionId?: string;
  originalTransactionId?: string;
  paymentMethod?: string;
  partyIdType?: string;
  partyId?: string;
  payeeNote?: string;
  payerMessage?: string;
  TransactionError?: {
    ErrorCode: string;
    ErrorMessage: string;
    ErrorType: string;
    ErrorSource: string;
  };
}
