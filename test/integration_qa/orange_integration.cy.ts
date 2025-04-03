describe('Orange Money API Automation', () => {
  let transactionId, uniqueId, accessToken;

  it('should process a payment charge', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
      body: {
        merchantId: 'M123',
        merchantMobileNo: '691654524',
        amount: 10000,
        transactionType: 'CHARGE',
        paymentMethod: 'ORANGE',
        customerPhone: '699944974',
        currency: 'EUR',
        cardData: {},
        metaData: {
          deviceId: 'deviceID',
          location: 'transaction_location',
          timestamp: 'transaction_timestamp',
        },
      },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('orangeApiKey')}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      transactionId = response.body.transactionDetails.transactionId;
      Cypress.env('transactionId', transactionId);
      cy.wait(500);
    });
  });

  it('should check transaction status', () => {
    cy.request({
      method: 'GET',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('orangeApiKey')}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.transaction.Item).to.have.property('status');
      uniqueId = response.body.transaction.Item.uniqueId;
      Cypress.env('uniqueId', uniqueId);
    });
  });

  describe('Verify Payment on Salesforce', () => {
    it(`Generates a Salesforce Access Token`, () => {
      cy.wait(1500);
      cy.request({
        method: 'POST',
        url: `${Cypress.env('salesforceTokenUrl')}`,
        body: {
          grant_type: `${Cypress.env('salesforceGrantType')}`,
          client_id: `${Cypress.env('salesforceClientId')}`,
          client_secret: `${Cypress.env('salesforceClientSecret')}`,
          username: `${Cypress.env('salesforceUsername')}`,
          password: `${Cypress.env('salesforcePassword')}`,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        accessToken = response.body.access_token;
        Cypress.env('accessToken', accessToken);
        cy.wait(500);
      });
    });

    it(`Verify Payment on salesforce`, () => {
      cy.wait(2000);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'PAYMENT_REQUEST_CREATED'
        );
        expect(response.body.records[0]).to.have.property('Fee__c', '200');
        expect(response.body.records[0]).to.have.property('amount__c', '9800');
        expect(response.body.records[0]).to.have.property(
          'Net_Amount__c',
          '10000'
        );
        expect(response.body.records[0]).to.have.property(
          'MerchantId__c',
          'M123'
        );
        expect(response.body.records[0]).to.have.property(
          'Merchant_Phone__c',
          '691654524'
        );
        expect(response.body.records[0]).to.have.property(
          'Customer_Phone__c',
          '699944974'
        );
        expect(response.body.records[0]).to.have.property(
          'ServiceType__c',
          'Orange'
        );
        expect(response.body.records[0]).to.have.property('currency__c', 'EUR');
      });
    });
  });
});
