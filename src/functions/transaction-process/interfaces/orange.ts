/**
 * Orange API token response structure
 */
export interface OrangeToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Orange Money payment init response
 */
export interface PaymentInitResponse {
  message: string;
  data: {
    payToken: string;
  };
}

/**
 * Orange Money payment response
 */
export interface PaymentResponse {
  message: string;
  data: {
    id: number;
    createtime: string;
    subscriberMsisdn: string;
    amount: number;
    payToken: string;
    txnid: string;
    txnmode: string;
    inittxnmessage: string;
    inittxnstatus: string;
    confirmtxnstatus: string | null;
    confirmtxnmessage: string | null;
    status: string;
    notifUrl: string;
    description: string;
    channelUserMsisdn: string;
  };
}

/**
 * Orange Money payment record structure
 * Extends the base payment record fields with Orange-specific response
 */
export interface OrangePaymentRecord {
  transactionId: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  customerPhone?: string;
  status: string;
  createdOn: number;
  paymentProviderResponse: PaymentResponse['data'];
  metaData?: Record<string, string>;
  mobileNo?: string;
  merchantId?: string;
  merchantMobileNo?: string;
  fee?: number;
  settlementAmount?: number;
  settlementStatus?: string;
  settlementId?: string;
  settlementDate?: number;
  transactionType?: string;
}

/**
 * Enum defining the types of transactions supported by Orange Money.
 * - PAYMENT: For collecting money from customers
 * - TRANSFER: For disbursing money to merchants
 */
export enum TransactionType {
  PAYMENT = 'payment',
  TRANSFER = 'transfer',
}
