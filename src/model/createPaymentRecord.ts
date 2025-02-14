import stripe from 'stripe';

export interface CreatePaymentRecord {
  transactionId: string;
  amount: number;
  fee?: number;
  paymentMethod: string;
  customerPhone?: string;
  destinationId?: string;
  status: string;
  createdOn: number;
  paymentProviderResponse?: stripe.Response<
    stripe.PaymentIntent | stripe.Refund
  >;
  metaData?: Record<string, string> | undefined;
  transactionType: string;
}
