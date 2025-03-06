import testData from 'cypress/fixtures/test_data.json';

let paymentMethodId, transactionId;

describe('Security Tests - API Response Verification', () => {
  describe('Invalid payload and unauthorized API request', () => {
    it('Should reject invalid payloads', () => {
      testData.invalidPayloads.forEach(({ testName, payload }) => {
        cy.log(`Testing: ${testName}`);

        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentApiUrl')}payment_methods`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: payload,
          failOnStatusCode: false,
        }).then((response) => {
          cy.task('log', response.body);
          expect(response.status).to.be.oneOf([402]);
          expect(response.body).to.have.property('error');
          expect(response.body.error).to.have.property('message');
        });
      });
    });

    it('Should reject unauthorized API request (missing API key)', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentApiUrl')}payment_methods`,
        form: true,
        body: {
          type: 'card',
          'card[number]': '4242424242424242',
          'card[exp_month]': '12',
          'card[exp_year]': '2025',
          'card[cvc]': '123',
        },
        failOnStatusCode: false, // Prevent test from failing on expected errors
      }).then((response) => {
        cy.task('log', response.body);
        expect(response.status).to.eq(401);
        expect(response.body).to.have.property('error');
        expect(response.body.error).to.have.property('message');
      });
    });
  });

  describe('Invalid API Key - Payment Processing', () => {
    it('Should return 401 and 403 Forbidden when using an invalid API key', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('InvalidApiKey')}`,
        },
        body: {
          merchantId: 'unique_merchant_identifier',
          amount: 120000,
          transactionType: 'CHARGE',
          paymentMethod: 'CARD',
          customerPhone: '3333',
          cardData: {
            paymentMethodId: 'random_payment_method_id',
            cardName: 'Visa',
            destinationId: 'acct_1QmXUNPsBq4jlflt',
            currency: 'eur',
          },
          metaData: {
            deviceId: 'device_identifier',
            location: 'transaction_location',
            timestamp: 'transaction_timestamp',
          },
        },
        failOnStatusCode: false,
      }).then((response) => {
        cy.task('log', response.body);
        expect([401, 403]).to.include(response.status);
        expect(response.body).to.have.property('message', 'Forbidden');
      });
    });

    it('Should return 403 Method Not Allowed when using GET instead of POST', () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentApiUrl')}payment_methods`,
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        cy.task('log', response.body);
        expect(response.status).to.eq(403);
        expect(response.body).to.have.property('error');
        expect(response.body.error).to.have.property(
          'message',
          'This API call cannot be made with a publishable API key. Please use a secret API key. You can find a list of your API keys at https://dashboard.stripe.com/account/apikeys.'
        );
      });
    });
  });

  describe('Invalid API Key - Transaction Status', () => {
    testData.testCard.forEach((card) => {
      it(`Create a Payment Method with ${card.type}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentApiUrl')}payment_methods`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': card.number,
            'card[exp_month]': '12',
            'card[exp_year]': '2025',
            'card[cvc]': '123',
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property('id');
          paymentMethodId = response.body.id;
          cy.task('log', response.body);
          cy.task('log', paymentMethodId);
          Cypress.env('paymentMethodId', paymentMethodId);
          cy.wait(500);
        });
      });

      it(`Process a Payment Charge with ${card.type}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('x-api-key')}`,
          },
          body: {
            merchantId: 'unique_merchant_identifier',
            amount: 120000,
            transactionType: 'CHARGE',
            paymentMethod: 'CARD',
            customerPhone: '3333',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: card.type,
              destinationId: 'acct_1QmXUNPsBq4jlflt',
              currency: 'eur',
            },
            metaData: {
              deviceId: 'device_identifier',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
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
          expect(response.body.transactionDetails).to.have.property(
            'status',
            'succeeded'
          );

          transactionId = response.body.transactionDetails.transactionId;
          cy.task('log', `Transaction ID for ${card.type}: ${transactionId}`);
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should return 401 and 403 Forbidden for invalid api key for transaction`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('paymentServiceEndpoint')}transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('InvalidApiKey')}`,
          },

          failOnStatusCode: false,
        }).then((response) => {
          cy.task('log', response.body);
          expect([401, 403]).to.include(response.status);
          expect(response.body).to.have.property('message', 'Forbidden');
        });
      });
    });
  });
});
