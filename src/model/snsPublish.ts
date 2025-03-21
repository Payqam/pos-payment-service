export interface SalesforceCredentials {
    clientSecret: string;
    clientId: string;
}
export interface SNSMessage {
    transactionId: string;
    status: string;
    amount: string;
    merchantId: string;
    merchantMobileNo: string;
    transactionType: string;
    metaData: Record<string, string>;
    fee: string;
    type: string;
    customerPhone: string;
    createdOn: string;
    currency: string;
    exchangeRate: string;
    processingFee: string;
    settlementAmount: string;
    externalTransactionId: string;
    paymentMethod: string;
    partyIdType: string;
    partyId: string;
    payeeNote: string;
    payerMessage: string;
    TransactionError: {
        ErrorCode: string;
        ErrorMessage: string;
        ErrorType: string;
        ErrorSource: string;
    };
}
