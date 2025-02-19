import stripe from 'stripe';

export interface CreatePaymentRecord {
  transactionId: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  customerPhone?: string;
  destinationId?: string;
  status: string;
  createdOn: number;
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
  settlementId?: string;
  settlementDate?: number;
  transactionType?: string;
}
