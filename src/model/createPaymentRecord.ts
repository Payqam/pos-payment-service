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
  paymentResponse?:
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
  merchantRefundId?: string;
  settlementDate?: number;
  transactionType?: string;
  GSI1SK: number;
  GSI2SK: number;
  exchangeRate?: string;
  processingFee?: string;
  netAmount?: string;
  externalTransactionId?: string;
  chargeMpResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  chargeMpGetResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  settlementCashInResponse?:
    | OrangePaymentResponse['data']
    | Record<string, any>;
  settlementCashInGetResponse?:
    | OrangePaymentResponse['data']
    | Record<string, any>;
  refundCashinResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  refundCashinGetResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  refundMpResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  refundMpGetResponse?: OrangePaymentResponse['data'] | Record<string, any>;
}

/**
 * Interface for creating refund reference records that map refund IDs to original transaction IDs
 */
export interface CreateRefundReferenceRecord {
  transactionId: string; // The refund transaction ID
  originalTransactionId: string; // The original transaction being refunded
}

export interface UpdatePaymentRecord {
  orderId?: string;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  customerPhone?: string;
  destinationId?: string;
  status?: string;
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
  merchantRefundId?: string;
  settlementDate?: number;
  transactionType?: string;
  GSI1SK?: number;
  GSI2SK?: number;
  exchangeRate?: string;
  processingFee?: string;
  netAmount?: string;
  externalTransactionId?: string;
  chargeMpResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  chargeMpGetResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  settlementCashInResponse?:
    | OrangePaymentResponse['data']
    | Record<string, any>;
  settlementCashInGetResponse?:
    | OrangePaymentResponse['data']
    | Record<string, any>;
  refundCashinResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  refundCashinGetResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  refundMpResponse?: OrangePaymentResponse['data'] | Record<string, any>;
  refundMpGetResponse?: OrangePaymentResponse['data'] | Record<string, any>;
}
