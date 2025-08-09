@RestResource(urlMapping='/PayQam/Streaming')
global class PayQamTransactionSync {
    
    @HttpPost
    global static String processPayment() {
        Savepoint sp;
        try {
            RestRequest req = RestContext.request;
            RestResponse res = RestContext.response;
            res.addHeader('Content-Type', 'application/json');
            
            // Deserialize the JSON payload
            Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            System.debug('Deserialized payload: ' + payload);

            
            // Start Transaction Control
            sp = Database.setSavepoint();
            
            // Create the transaction record
            Id transactionId = createTransaction(payload);
            
            // Handle transaction error creation if needed
            if (payload.containsKey('transactionError')) {
                Map<String, Object> errorDetails = (Map<String, Object>) payload.get('transactionError');
                System.debug('begin transactionId-----> ' + transactionId);
                createTransactionError(transactionId, errorDetails);
            }
            
            // Commit the transaction
            return JSON.serializePretty(new Map<String, Object>{
                'status' => 'success',
                    'transactionId' => transactionId,
                    'message' => 'Transaction processed successfully'
                    });
            
        } catch (CustomTransactionException e) {
            Database.rollback(sp);
            System.debug('Transaction Error: ' + e.getMessage());
            return JSON.serializePretty(new Map<String, Object>{
                'status' => 'Error',
                    'message' => 'Transaction creation failed',
                    'errorDetail' => e.getMessage() + ' LineNumber: ' + e.getLineNumber()
                    });
            
        } catch (Exception e) {
            Database.rollback(sp);
            System.debug('Unexpected Error: ' + e.getMessage());
            return JSON.serializePretty(new Map<String, Object>{
                'status' => 'Error',
                    'message' => 'Failed to process payment request',
                    'errorDetail' => e.getMessage(),
                    'lineNumber' => e.getLineNumber()
                    });
        }
    }
    
    // Method to create a Transaction record
    private static Id createTransaction(Map<String, Object> payload) {
        try {
            String transactionIdValue = getStringValue(payload, 'transactionId');
            
            // Check if transaction already exists
            Transaction__c existingTransaction;
            List<Transaction__c> existingTransactionList = [
                SELECT Id, TransactionId__c, Status__c, Amount__c, MerchantId__c, Account__c, 
                Transaction_Type__c, MetaData__c, Fee__c, Device_id__c, Transaction_Date_Time__c, 
                Customer_Phone__c, Currency__c, Exchange_Rate__c, Processing_Fee__c, 
                Net_Amount__c, ExternalTransactionId__c
                FROM Transaction__c 
                WHERE TransactionId__c = :transactionIdValue 
                LIMIT 1
            ];
            
            Transaction__c tran;
            
            if (!existingTransactionList.isEmpty()) {
                tran = existingTransactionList[0]; // Use existing record
            } else {
                tran = new Transaction__c(); // Create new record
            }
            
            if (String.isNotBlank(getStringValue(payload, 'originalTransactionId'))) {
                String originalTransactionId = getStringValue(payload, 'originalTransactionId');
                tran.Original_Transaction__c = getOriginalTransactionId(originalTransactionId);
            }
            
            // Update fields only if they have non-blank values in payload
            if (String.isNotBlank(getStringValue(payload, 'transactionId'))) {
                tran.TransactionId__c = getStringValue(payload, 'transactionId');
            }
            if (String.isNotBlank(getStringValue(payload, 'status'))) {
                tran.Status__c = getStringValue(payload, 'status');
            }
            
            if (String.isNotBlank(getStringValue(payload, 'amount'))) {
                tran.Amount__c = getStringValue(payload, 'amount');
            }
            if (String.isNotBlank(getStringValue(payload, 'merchantId'))) {
                tran.MerchantId__c = getStringValue(payload, 'merchantId');
                tran.Account__c = getAccountIdValue(getStringValue(payload, 'merchantId'));
            }
            if (String.isNotBlank(getStringValue(payload, 'transactionType'))) {
                tran.Transaction_Type__c = getStringValue(payload, 'transactionType');
            }
            if (String.isNotBlank(getStringValue(payload, 'metaData'))) {
                tran.MetaData__c = getStringValue(payload, 'metaData');
            }
            if (String.isNotBlank(getStringValue(payload, 'fee'))) {
                tran.Fee__c = getStringValue(payload, 'fee');
            }
            if (String.isNotBlank(getStringValue(payload, 'deviceId'))) {
                tran.Device_id__c = getStringValue(payload, 'deviceId');
            }
            if (getDatetimeValue(payload, 'transactionDateTime') != null) {
                tran.Transaction_Date_Time__c = getDatetimeValue(payload, 'transactionDateTime');
            }
            if (String.isNotBlank(getStringValue(payload, 'customerPhone'))) {
                tran.Customer_Phone__c = getStringValue(payload, 'customerPhone');
            }
            if (String.isNotBlank(getStringValue(payload, 'currency'))) {
                tran.Currency__c = getStringValue(payload, 'currency');
            }
            if (String.isNotBlank(getStringValue(payload, 'exchangeRate'))) {
                tran.Exchange_Rate__c = getStringValue(payload, 'exchangeRate');
            }
            if (String.isNotBlank(getStringValue(payload, 'processingFee'))) {
                tran.Processing_Fee__c = getStringValue(payload, 'processingFee');
            }
            if (String.isNotBlank(getStringValue(payload, 'netAmount'))) {
                tran.Net_Amount__c = getStringValue(payload, 'netAmount');
            }
            if (String.isNotBlank(getStringValue(payload, 'externalTransactionId'))) {
                tran.ExternalTransactionId__c = getStringValue(payload, 'externalTransactionId');
            }
            if (String.isNotBlank(getStringValue(payload, 'serviceType'))) {
                tran.ServiceType__c = getStringValue(payload, 'serviceType');
            }
            if (String.isNotBlank(getStringValue(payload, 'customerPhone'))) {
                tran.Customer_Phone__c = getStringValue(payload, 'customerPhone');
            }
            if (String.isNotBlank(getStringValue(payload, 'merchantPhone'))) {
                tran.Merchant_Phone__c = getStringValue(payload, 'merchantPhone');
            }

            
            upsert tran;
            
            return tran.Id;
            
        } catch (Exception e) {
            throw new CustomTransactionException('Failed to insert/update transaction record: ' + e.getMessage());
        }
    }
    
    // Method to create a TransactionError record
    private static void createTransactionError(Id transactionId, Map<String, Object> errorDetails) {
        System.debug('inside transactionId-----> ' + transactionId);
          System.debug('inside errorDetails-----> ' +errorDetails);
        try {
            Transaction_Error__c errorRecord = new Transaction_Error__c();
            errorRecord.Transaction__c = transactionId;
            errorRecord.Error_Code__c = getStringValue(errorDetails, 'errorCode');
            errorRecord.Error_Message__c = getStringValue(errorDetails, 'errorMessage');
            errorRecord.Error_Type__c = getStringValue(errorDetails, 'errorType');
            errorRecord.Error_Source__c = getStringValue(errorDetails, 'errorSource');
            
            insert errorRecord;
        } catch (Exception e) {
            throw new CustomTransactionException('Transaction error record creation failed: ' + e.getMessage());
        }
    }
    
    // Utility method to safely extract string values and return '' if blank or null
    private static String getStringValue(Map<String, Object> payload, String key) {
        return payload.containsKey(key) && payload.get(key) != null && String.isNotBlank((String) payload.get(key)) 
            ? (String) payload.get(key) 
            : '';
    }
    
    // Utility method to safely extract datetime values
private static Datetime getDatetimeValue(Map<String, Object> payload, String key) {
    if (payload.containsKey(key) && payload.get(key) != null) {
        try {
            String dateString = (String) payload.get(key);
            // Convert "2024-03-21T10:30:00" to "2024-03-21 10:30:00"
            dateString = dateString.replace('T', ' '); 
            return Datetime.valueOf(dateString);
        } catch (Exception e) {
            throw new CustomTransactionException('Invalid date/time format for ' + key + ': ' + payload.get(key));
        }
    }
    return null;
}

    
    // Utility method to safely extract account Id
    private static String getAccountIdValue(String merchantId) {
        if (String.isNotBlank(merchantId)) {
            List<Account> accounts = [SELECT Id, Phone FROM Account WHERE MerchantId__c = :merchantId OR Phone = :merchantId LIMIT 1];
            System.debug('accounts--------------> ' + accounts);
            if (!accounts.isEmpty()) {
                return accounts[0].Id;
            }
        }
        return null;
    }
    
    
    private static String  getOriginalTransactionId(String originalTransactionId) {
        if (String.isNotBlank(originalTransactionId)) {
            List<Transaction__c> originalTransactionIdList = [
                SELECT Id, TransactionId__c
                FROM Transaction__c 
                WHERE TransactionId__c = :originalTransactionId
                LIMIT 1
            ];
            System.debug('originalTransactionIdList--------------> ' +originalTransactionIdList);
            if (!originalTransactionIdList.isEmpty()) {
                return originalTransactionIdList[0].Id;
            }
        }
        return null;
    }
    
    
    // Custom Exception Class for Transactions
    public class CustomTransactionException extends Exception {}
}