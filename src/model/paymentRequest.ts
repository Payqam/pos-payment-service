import stripe from 'stripe';

interface CardData {
  paymentMethodId?: string;
  cardName?: string;
  destinationId?: string;
  currency?: string;
  paymentIntentId?: string;
  reverse_transfer?: boolean;
  reason?: stripe.RefundCreateParams.Reason;
}

interface PaymentRequest {
  amount: number;
  paymentMethod: string;
  cardData?: CardData;
  customerPhone?: string;
  metaData?: Record<string, string>;
  transactionType?: string;
  merchantId: string;
}

export { CardData, PaymentRequest };
