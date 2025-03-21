let transactionId, uniqueId, accessToken;
describe('Orange Money Automation', () => {
  it('should process a payment charge', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
      body: {
        merchantId: 'M123',
        merchantMobileNo: '691654529',
        amount: 12000,
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
      cy.task('log', response.body);
      transactionId = response.body.transactionDetails.transactionId;
      cy.task('log', `Transaction ID : ${transactionId}`);
      Cypress.env('transactionId', transactionId);
      cy.wait(500);
    });
  });

  it('should check transaction status', () => {
    cy.wait(3500);
    cy.request({
      method: 'GET',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=6d521f9b-9c75-4c0c-8a29-453321cab131`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('orangeApiKey')}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.transaction.Item).to.have.property('status');
      expect(response.body.transaction.Item).to.have.property(
        'status',
        'PAYMENT_PENDING'
      );
      uniqueId = response.body.transaction.Item.uniqueId;
      cy.task('log', ` ${uniqueId}`);
      Cypress.env('uniqueId', uniqueId);
      cy.task('log', response.body);
    });
  });

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
      cy.task('log', response.body);
      accessToken = response.body.access_token;
      cy.task('log', `access_token : ${accessToken}`);
      Cypress.env('accessToken', accessToken);
      cy.wait(500);
    });
  });

  it(`Verify Payment on salesforce`, () => {
    cy.request({
      method: 'GET',
      url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
      headers: {
        Authorization: `Bearer ${Cypress.env('accessToken')}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.records[0]).to.have.property(
        'status__c',
        'PAYMENT_REQUEST_CREATED'
      );
      expect(response.body.records[0]).to.have.property('Fee__c', '240');
      // expect(response.body.records[0]).to.have.property('amount__c', '97.5');
      expect(response.body.records[0]).to.have.property(
        'MerchantId__c',
        'M123'
      );
      cy.task('log', response.body);
    });
  });
});

describe('Orange Money Refund Automation', () => {
  it('should process a payment charge', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
      body: {
        merchantId: 'm_id',
        merchantMobileNo: '691654529',
        amount: 100000,
        transactionType: 'CHARGE',
        paymentMethod: 'ORANGE',
        customerPhone: '691654524',
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
      cy.task('log', response.body);
      transactionId = response.body.transactionDetails.transactionId;
      cy.task('log', `Transaction ID : ${transactionId}`);
      Cypress.env('transactionId', transactionId);
      cy.wait(500);
    });
  });

  it('should check transaction status', () => {
    cy.wait(5000);
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
      expect(response.body.transaction.Item).to.have.property(
        'status',
        'PAYMENT_SUCCESSFUL'
      );
      uniqueId = response.body.transaction.Item.uniqueId;
      cy.task('log', ` ${uniqueId}`);
      Cypress.env('uniqueId', uniqueId);
      cy.task('log', response.body);
    });
  });

  it('should process a payment charge', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/refund`,
      body: {
        transactionId: `${Cypress.env('transactionId')}`,
        merchantId: 'm_id',
        amount: 100000,
        transactionType: 'REFUND',
        paymentMethod: 'ORANGE',
        customerPhone: '691654524',
        currency: 'EUR',
        cardData: {},
        metaData: {
          deviceId: 'deviceID',
          location: 'transaction_location',
          timestamp: 'transaction_timestamp',
        },
        merchantMobileNo: '691654529',
      },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('orangeApiKey')}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      cy.task('log', response.body);
      transactionId = response.body.transactionDetails.transactionId;
      cy.task('log', `Transaction ID : ${transactionId}`);
      Cypress.env('transactionId', transactionId);
      cy.wait(500);
    });
  });

  it('should check transaction status', () => {
    cy.wait(3500);
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
      expect(response.body.transaction.Item).to.have.property(
        'status',
        'PAYMENT_PENDING'
      );
      uniqueId = response.body.transaction.Item.uniqueId;
      cy.task('log', ` ${uniqueId}`);
      Cypress.env('uniqueId', uniqueId);
      cy.task('log', response.body);
    });
  });

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
      cy.task('log', response.body);
      accessToken = response.body.access_token;
      cy.task('log', `access_token : ${accessToken}`);
      Cypress.env('accessToken', accessToken);
      cy.wait(500);
    });
  });

  it(`Verify Payment on salesforce`, () => {
    cy.request({
      method: 'GET',
      url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
      headers: {
        Authorization: `Bearer ${Cypress.env('accessToken')}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.records[0]).to.have.property(
        'status__c',
        'MERCHANT_REFUND_SUCCESSFUL'
      );
      expect(response.body.records[0]).to.have.property(
        'MerchantId__c',
        'M123'
      );
    });
  });
});
