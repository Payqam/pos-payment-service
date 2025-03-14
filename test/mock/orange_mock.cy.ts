describe('Orange Money API Automation', () => {
  let transactionId, uniqueId;

  it('should process a payment charge', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
      body: {
        merchantId: '691654524',
        merchantMobileNo: '691654524',
        amount: 120000,
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
        'PENDING'
      );
      uniqueId = response.body.transaction.Item.uniqueId;
      cy.task('log', ` ${uniqueId}`);
      Cypress.env('uniqueId', uniqueId);
      cy.task('log', response.body);
    });
  });

  it('should successfully trigger the Orange Webhook', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/webhooks/orange`,
      body: {
        type: 'payment_notification',
        data: { payToken: `${Cypress.env('uniqueId')}` },
      },
      headers: {
        'Content-Type': 'application/json',
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
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
      cy.task('log', response.body);
      expect(response.status).to.eq(200);
      expect(response.body.transaction.Item).to.have.property(
        'settlementStatus',
        'SUCCESSFUL'
      );
    });
  });
});
