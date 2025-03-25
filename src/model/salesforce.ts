export interface SalesforcePaymentRecord {
  ownerId: string;
  serviceType: string;
  transactionId: string;
  status: string;
  amount: string;
  merchantId: string;
  merchantPhone: string;
  transactionType: string;
  metaData: string;
  fee: string;
  deviceId: string;
  transactionDateTime: string;
  customerPhone: string;
  currency: string;
  exchangeRate: string;
  processingFee: string;
  externalTransactionId: string;
  originalTransactionId: string;
  netAmount: string;
  transactionError?: {
    errorCode: string;
    errorMessage: string;
    errorType: string;
    errorSource: string;
  };
}
