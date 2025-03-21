export interface SalesforcePaymentRecord {
  amount__c: string;
  currency__c: string;
  Customer_Phone__c: string;
  Device_Id__c: string;
  Exchange_Rate__c: string;
  ExternalTransactionId__c: string;
  Fee__c: string;
  Merchant_Phone__c: string;
  MerchantId__c: string;
  metaData__c: string;
  Net_Amount__c: string;
  OwnerId: string;
  Processing_Fee__c: string;
  ServiceType__c: string;
  status__c: string;
  Transaction_Date_Time__c: string;
  Transaction_Type__c: string;
  transactionId__c: string;
  TransactionError?: {
    ErrorCode__c: string;
    ErrorMessage__c: string;
    ErrorType__c: string;
    ErrorSource__c: string;
  };
}
