interface CardData {
  id: string;
  cardName: string;
  destinationId: string;
}

interface PaymentRequest {
  amount: number;
  paymentMethod: string;
  cardData?: CardData;
  customerPhone?: string;
  metaData?: Record<string, string>;
  merchantId: string;
}

export { CardData, PaymentRequest };
