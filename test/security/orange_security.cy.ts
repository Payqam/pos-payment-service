import testData from '../../cypress/fixtures/mtn_test_data.json';

describe('Security Tests - API Response Verification ', () => {
  let transactionId;
  describe(`API Key Validation for Payment Process`, () => {
    (
      Cypress.env('apiKeyValidation') as { title: string; apiKey: string }[]
    ).forEach((invalidApiKey) => {
      it(`Verify 403 error for ${invalidApiKey.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${invalidApiKey.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            merchantId: 'M123',
            merchantMobileNo: '691654524',
            amount: 100,
            customerPhone: '699944974',
            transactionType: 'CHARGE',
            paymentMethod: 'ORANGE',
            currency: 'EUR',
            metaData: {
              reference: 'ORDER_123',
              description: 'Payment for order #123',
            },
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(403);
          cy.wait(500);
        });
      });
    });
  });

  describe(`API Key Validation for Transaction Process`, () => {
    (
      Cypress.env('apiKeyValidation') as { title: string; apiKey: string }[]
    ).forEach((invalidApiKey) => {
      describe(`API Key Validation with ${invalidApiKey.title}`, () => {
        it('should process a payment', () => {
          cy.request({
            method: 'POST',
            url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
            headers: {
              'x-api-key': `${Cypress.env('orangeApiKey')}`,
              'Content-Type': 'application/json',
            },
            body: {
              merchantId: 'M123',
              merchantMobileNo: '691654524',
              amount: 100,
              customerPhone: '699944974',
              transactionType: 'CHARGE',
              paymentMethod: 'ORANGE',
              currency: 'EUR',
              metaData: {
                reference: 'ORDER_123',
                description: 'Payment for order #123',
              },
            },
          }).then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body).to.have.property(
              'message',
              'Payment processed successfully'
            );
            expect(response.body).to.have.property('transactionDetails');
            expect(response.body.transactionDetails).to.have.property(
              'transactionId'
            );
            expect('PAYMENT_REQUEST_CREATED').to.include(
              response.body.transactionDetails.status
            );

            transactionId = response.body.transactionDetails.transactionId;
            Cypress.env('transactionId', transactionId);
            cy.wait(500);
          });
        });

        it(`Verify 403 error for ${invalidApiKey.title}`, () => {
          cy.request({
            method: 'GET',
            url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
            headers: {
              'x-api-key': `${invalidApiKey.apiKey}`,
              'Content-Type': 'application/json',
            },
            failOnStatusCode: false,
          }).then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body).to.have.property('message', 'Forbidden');
          });
          cy.wait(500);
        });
      });
    });
  });

  describe('Validate WAF - Block Malicious Payloads', () => {
    it('Validate WAF - Block Malicious Payloads', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          merchantId: 'M123',
          merchantMobileNo: '691654524',
          amount: 100,
          customerPhone: '699944974',
          transactionType: '<script>alert("XSS")</script>',
          paymentMethod: 'ORANGE',
          currency: 'EUR',
          metaData: {
            reference: 'ORDER_123',
            description: 'Payment for order #123',
          },
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });

    it('Validate API XSS Protection', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          comment: '<script>alert("XSS")</script>',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });
  });

  describe('Validate SQL Injection Protection', () => {
    it('Validate SQL Injection Protection', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          merchantId: 'M123',
          merchantMobileNo: '691654524',
          amount: 100,
          customerPhone: '699944974',
          transactionType: 'CHARGE',
          paymentMethod: 'ORANGE',
          currency: "' OR '1'='1",
          metaData: {
            reference: 'ORDER_123',
            description: 'Payment for order #123',
          },
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });

    it('Validate Input Sanitization Against SQL Injection', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          query: "' OR '1'='1",
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });

    it('Validate Command Injection Vulnerability', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          command: 'rm -rf /',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });
});
