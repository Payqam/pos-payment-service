//Will Complete additional enhancements and error handling once production access is available.
import testData from '../../cypress/fixtures/orange_test_data.json';
let transactionId;

describe('Orange Payment Processing Tests - Negative Scenarios', () => {
  describe('Verify payment request with Invalid details', () => {
    it('should return 400 Bad Request when payer details are missing', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        body: {
          merchantId: '691654524',
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
          merchantMobileNo: '691654524',
        },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('InvalidApiKey')}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
        cy.task('log', response.body);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Forbidden');
      });
    });

    it('should return 400 Bad Request with empty request body', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        body: {},
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        cy.task('log', response.body);
        expect(response.body.message).to.include('Invalid request body');
      });
    });
  });

  describe('Verify request without x-api-key', () => {
    describe('Verify transaction status request without x-api-key', () => {
      it('should process a payment charge', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          body: {
            merchantId: '691654524',
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
            merchantMobileNo: '691654524',
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

      it('`should return 403 Bad Request', () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': '',
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(403);
          cy.task('log', response.body);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include('Forbidden');
        });
      });
    });

    describe('Verify payment process request without x-api-key', () => {
      it('should return 400 Bad Request when api key is missing', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          body: {
            merchantId: '691654524',
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
            merchantMobileNo: '691654524',
          },
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ' ',
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(403);
          cy.task('log', response.body);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include('Forbidden');
        });
      });
    });
  });

  describe('Verify payment request with Invalid and Empty Data', () => {
    testData.invalidData.forEach((test) => {
      it(`should return ${test.expectedStatus} Bad Request when using ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          body: {
            merchantId: test.body['orange[merchantId]'] || '691654524',
            amount: test.body['orange[amount]'] || '12000',
            transactionType: 'CHARGE',
            paymentMethod: 'ORANGE',
            customerPhone: test.body['orange[customerPhone]'] || '94767987987',
            currency: test.body['orange[currency]'] || 'EUR',
            cardData: {},
            metaData: {
              deviceId: 'deviceID',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
            merchantMobileNo:
              test.body['orange[merchantMobileNo]'] || '94767987987',
          },
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('orangeApiKey')}`,
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
