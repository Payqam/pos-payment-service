import testData from '../../cypress/fixtures/test_data.json';
let paymentMethodId, transactionId, uniqueId;

describe('Stripe Payment Processing Tests', () => {
  describe('Validate Successful Payment Processing', () => {
    it('Create a Payment Method', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentApiUrl')}payment_methods`,
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
        },
        form: true,
        body: {
          type: 'card',
          'card[number]': '4242424242424242',
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

    it(`Process a Payment Charge`, () => {
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
            cardName: 'visa',
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
        cy.task('log', response.body);
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
        cy.task('log', `Transaction ID : ${transactionId}`);
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it(`Should retrieve transaction status`, () => {
      cy.wait(3500);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('x-api-key')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        cy.task('log', response.body);
        expect(response.body).to.have.property(
          'message',
          'Transaction retrieved successfully'
        );
        expect(response.body.transaction.Item).to.have.property(
          'status',
          'CHARGE_UPDATED'
        );
        uniqueId = response.body.transaction.Item.uniqueId;
        cy.task('log', ` ${uniqueId}`);
        Cypress.env('uniqueId', uniqueId);
      });
      cy.wait(500);
    });

    it(`Verify Payment on Stripe`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentApiUrl')}payment_intents/${Cypress.env('uniqueId')}`,
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        cy.task('log', response.body);
        expect(response.body).to.have.property('status', 'succeeded');
        expect(response.body).to.have.property('amount', 120000);
        expect(response.body).to.have.property('currency', 'eur');
        expect(response.body.transfer_data).to.have.property('amount', 117600);
      });
    });
  });

  describe('Validate Invalid and Duplicate Requests Payment Processing', () => {
    it('Validate Request with Invalid Stripe Credentials', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentApiUrl')}payment_methods`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('InvalidApiKey')}`,
        },
        failOnStatusCode: false,
        form: true,
        body: {
          type: 'card',
          'card[number]': '4242424242424242',
          'card[exp_month]': '12',
          'card[exp_year]': '2025',
          'card[cvc]': '123',
        },
      }).then((response) => {
        expect(response.status).to.eq(401);
        cy.task('log', response.body);
      });
    });
  });

  describe('Validate Idempotency for Duplicate Requests', () => {
    testData.idempotency.forEach(({ idempotencyKey }) => {
      it('Create a Payment Method', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentApiUrl')}payment_methods`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': '4242424242424242',
            'card[exp_month]': '12',
            'card[exp_year]': '2025',
            'card[cvc]': '123',
          },
          failOnStatusCode: false,
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

      it(`Verify 500 Response for Duplicate Requests`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('x-api-key')}`,
            'Idempotency-Key': idempotencyKey,
          },
          body: {
            merchantId: 'unique_merchant_identifier',
            amount: 120000,
            transactionType: 'CHARGE',
            paymentMethod: 'CARD',
            customerPhone: '3333',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: 'visa',
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
          expect(response.status).to.eq(200);

          cy.request({
            method: 'POST',
            url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
            headers: {
              'x-api-key': `${Cypress.env('x-api-key')}`,
              'Idempotency-Key': idempotencyKey,
            },
            body: {
              merchantId: 'unique_merchant_identifier',
              amount: 120000,
              transactionType: 'CHARGE',
              paymentMethod: 'CARD',
              customerPhone: '3333',
              cardData: {
                paymentMethodId: Cypress.env('paymentMethodId'),
                cardName: 'visa',
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
          }).then((duplicateResponse) => {
            expect(duplicateResponse.status).to.eq(500);
            cy.task('log', duplicateResponse.body);
          });
        });
      });
    });
  });
});
