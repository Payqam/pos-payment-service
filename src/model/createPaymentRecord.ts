import { PaymentResponse as OrangePaymentResponse } from '../functions/transaction-process/interfaces/orange';
import Stripe from 'stripe';

export interface CreatePaymentRecord {
  transactionId: string;
  orderId?: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  customerPhone?: string;
  destinationId?: string;
  status: string;
  paymentProviderResponse?:
    | Stripe.PaymentIntent
    | Stripe.Refund
    | OrangePaymentResponse['data']
    | Record<string, any>; // For other providers or error responses
  metaData?: Record<string, string> | undefined;
  mobileNo?: string;
  merchantId?: string;
  merchantMobileNo?: string;
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
