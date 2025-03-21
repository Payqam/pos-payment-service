export interface SalesforcePaymentRecord {
  amount__c: string;
  Currency__c: string;
  Customer_Phone__c: string;
  Device_id__c: string;
  ExchangeRate__c: string;
  ExternalTransactionId__c: string;
  fee__c: string;
  Merchant_Phone__c: string;
  merchantId__c: string;
  metaData__c: string;
  NetAmount__c: string;
  OwnerId: string;
  ProcessingFee__c: string;
  ServiceType: string;
  status__c: string;
  Transaction_Date_Time__c: string;
  transactionType__c: string;
  transactionId__c: string;
  TransactionError?: {
    ErrorCode__c: string;
    ErrorMessage__c: string;
    ErrorType__c: string;
    ErrorSource__c: string;
  };
}
