import stripe from 'stripe';

export interface CreatePaymentRecord {
  transactionId: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  customerPhone?: string;
  destinationId?: string;
  status: string;
  paymentProviderResponse?: stripe.Response<
    stripe.PaymentIntent | stripe.Refund
  >;
  metaData?: Record<string, string> | undefined;
  mobileNo?: string;
  merchantId?: string;
  merchantMobileNo?: string; // Added merchant's mobile number
  fee?: number;
  settlementAmount?: number;
  settlementStatus?: string;
  uniqueId?: string;
  settlementDate?: number;
  transactionType?: string;
  GSI1SK: number;
  GSI2SK: number;
  exchangeRate?: string;
  processingFee?: string;
  netAmount?: string;
  externalTransactionId?: string;
}
