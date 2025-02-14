export interface CreatePaymentRecord {
  transactionId: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  createdOn: number;
  status: string;
  paymentProviderResponse?: Record<string, never>;
  metaData?: Record<string, never> | Record<string, string>;
  mobileNo?: string;
  merchantId?: string;
  fee?: number;
  settlementAmount?: number;
  settlementStatus?: string;
  settlementId?: string;
  settlementDate?: number;
}
