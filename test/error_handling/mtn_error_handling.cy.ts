import testData from '../../cypress/fixtures/mtn_test_data.json';
let accessToken;

describe('MTN Payment Processing Tests - Negative Scenarios', () => {
  describe('Verify payment request with Invalid details', () => {
    it('should return 400 Bad Request when payer details are missing', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('InvalidApiKey')}`,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          merchantId: 'MERCHANT_123',
          merchantMobileNo: '94767987987',
          customerPhone: '94713579023',
          amount: 100.12,
          currency: 'EUR',
          transactionType: 'PAYMENT',
          paymentMethod: 'MTN',
          metaData: {
            reference: 'ORDER_123',
            description: 'Payment for order #123',
          },
        },
      }).then((response) => {
        expect(response.status).to.eq(403);
        cy.task('log', response.body);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Forbidden');
      });
    });

    testData.invalidData.forEach((test) => {
      it(`should return ${test.expectedStatus} Bad Request when using ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
          body: {
            merchantId: 'MERCHANT_123',
            merchantMobileNo:
              test.body['mtn[merchantMobileNo]'] || '94767987987',
            amount: test.body['mtn[amount]'] || 1000,
            customerPhone: test.body['mtn[customerPhone]'] || '94786987543',
            transactionType: 'PAYMENT',
            paymentMethod: 'MTN',
            currency: 'EUR',
            metaData: {
              reference: 'ORDER_123',
              description: 'Payment for order #123',
            },
          },
        }).then((response) => {
          expect(response.status).to.eq(test.expectedStatus);
          cy.task('log', response.body);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include(test.expectedMessage);
        });
      });
    });
  });
  describe('Verify transaction status with Invalid details', () => {
    testData.invalidId.forEach((test) => {
      it(`should return ${test.expectedStatus} Bad Request when using ${test.title}`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${test.transactionId}`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          cy.task('log', response.body);
        });
      });

      it('Generates an Access Token', () => {
        cy.request({
          method: 'POST',
          url: 'https://sandbox.momodeveloper.mtn.com/collection/token/',
          headers: {
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNCollectionSubscriptionKey')}`,
            Authorization:
              'Basic ' +
              btoa(
                `${Cypress.env('MTNCollectionApiUser')}:${Cypress.env('MTNCollectionApiKey')}`
              ),
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          accessToken = response.body.access_token;
          cy.task('log', accessToken);
          Cypress.env('accessToken', accessToken);
        });
      });

      it('Checks Transaction Status', () => {
        cy.request({
          method: 'GET',
          url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${test.transactionId}`,
          headers: {
            'X-Target-Environment': 'sandbox',
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNCollectionSubscriptionKey')}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(test.expectedStatus);
        });
      });
    });
  });
});

describe('MTN Request to Pay Payer Tests - Negative Scenarios', () => {
  testData.requestToPayPayer.forEach((test) => {
    it(`should return 500 Bad Request when using ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          merchantId: 'MERCHANT_123',
          merchantMobileNo: '94767987987',
          amount: 100.12,
          customerPhone: test.payer,
          transactionType: 'PAYMENT',
          paymentMethod: 'MTN',
          currency: 'EUR',
          metaData: {
            reference: 'ORDER_123',
            description: 'Payment for order #123',
          },
        },
      }).then((response) => {
        expect(response.status).to.eq(500);
        cy.task('log', response.body);
        expect(response.body).to.have.property(
          'message',
          'Unsupported transaction type: PAYMENT'
        );
      });
    });
  });
});

describe('MTN Account Holder Active Party Code Tests - Negative Scenarios', () => {
  testData.AccountHolderActivePartyCode.forEach((test) => {
    describe(`Account Holder Active Party Code Tests for ${test.title}`, () => {
      it('should get transaction status', () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${test.transactionId}`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          cy.task('log', response.body);
          expect(response.body).to.have.property(
            'message',
            'Transaction retrieved successfully'
          );
        });
      });

      it('Generates an Access Token', () => {
        cy.request({
          method: 'POST',
          url: 'https://sandbox.momodeveloper.mtn.com/collection/token/',
          headers: {
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNCollectionSubscriptionKey')}`,
            Authorization:
              'Basic ' +
              btoa(
                `${Cypress.env('MTNCollectionApiUser')}:${Cypress.env('MTNCollectionApiKey')}`
              ),
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          accessToken = response.body.access_token;
          cy.task('log', accessToken);
          Cypress.env('accessToken', accessToken);
        });
      });

      it(`Checks Transaction Status for ${test.title}`, () => {
        cy.request({
          method: 'GET',
          url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${test.transactionId}`,
          headers: {
            'X-Target-Environment': 'sandbox',
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNCollectionSubscriptionKey')}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(404);
          cy.task('log', response.body);
          expect(response.body).to.have.property(
            'message',
            'Requested resource was not found.'
          );
        });
      });
    });
  });
});

describe('Validate Refund process Negative Scenarios', () => {
  testData.invalidRefundData.forEach((test) => {
    describe(`Validate Refund process for ${test.title}`, () => {
      it(`should return ${test.expectedStatus} Bad Request with refund using ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
          body: {
            transactionType: 'REFUND',
            paymentMethod: test.body['mtn[paymentMethod]'] || 'MTN',
            transactionId:
              test.body['mtn[transactionId]'] ||
              `${Cypress.env('transactionId')}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(test.expectedStatus);
          cy.task('log', response.body);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include(test.expectedMessage);
        });
      });
    });
  });
});
