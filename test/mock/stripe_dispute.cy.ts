import testData from 'cypress/fixtures/test_data.json';
let paymentMethodId, transactionId, uniqueId;

describe('Dispute', () => {
  testData.testCardsFraudulentAndDisputes.forEach((dispute) => {
    describe(`Dispute- ${dispute.type}`, () => {
      it(`Create a Payment Method with ${dispute.type}`, () => {
        cy.request({
          method: 'POST',
          url: 'https://api.stripe.com/v1/payment_methods',
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': dispute.number,
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

      it(`Process a Payment Charge with ${dispute.type}`, () => {
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
              cardName: dispute.type,
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
          cy.task(
            'log',
            `Transaction ID for ${dispute.type}: ${transactionId}`
          );
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should retrieve transaction status with ${dispute.type}`, () => {
        cy.wait(3000);
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
        cy.wait(2000);
      });

      it(`Verify Payment on Stripe for ${dispute.type}`, () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/payment_intents/${Cypress.env('uniqueId')}`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property('id');
          cy.task('log', response.body);
          expect(response.body).to.have.property('status', 'succeeded');
          expect(response.body).to.have.property('amount', 120000);
          expect(response.body).to.have.property('currency', 'eur');
          expect(response.body.transfer_data).to.have.property(
            'amount',
            108000
          );
          cy.wait(5000);
        });
      });

      it(`Retrieve dispute details for ${dispute.type} `, () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/disputes?payment_intent=${Cypress.env('uniqueId')}`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          cy.task('log', response.body);
          expect(response.status).to.eq(200);
          expect(response.body.data[0]).to.have.property(
            'status',
            'needs_response'
          );
          expect(response.body.data[0]).to.have.property(
            'reason',
            'fraudulent'
          );
        });
      });

      it(`Accept dispute for ${dispute.type}`, () => {
        cy.request({
          method: 'POST',
          url: `https://api.stripe.com/v1/disputes/${Cypress.env('uniqueId')}/close`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property('status', 'lost'); // Stripe marks it as lost when accepted
          cy.task(
            'log',
            `Dispute accepted for transaction ${Cypress.env('transactionId')}`
          );
        });
      });
    });
  });
});

describe('Dispute - Not Received', () => {
  testData.testCardsNotReceived.forEach((dispute) => {
    describe(`Dispute- ${dispute.type}`, () => {
      it(`Create a Payment Method with ${dispute.type}`, () => {
        cy.request({
          method: 'POST',
          url: 'https://api.stripe.com/v1/payment_methods',
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': dispute.number,
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

      it(`Process a Payment Charge with ${dispute.type}`, () => {
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
              cardName: dispute.type,
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
          cy.task(
            'log',
            `Transaction ID for ${dispute.type}: ${transactionId}`
          );
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should retrieve transaction status with ${dispute.type}`, () => {
        cy.wait(3000);
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

      it(`Verify Payment on Stripe for ${dispute.type}`, () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/payment_intents/${Cypress.env('uniqueId')}`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property('id');
          cy.task('log', response.body);
          expect(response.body).to.have.property('status', 'succeeded');
          expect(response.body).to.have.property('amount', 120000);
          expect(response.body).to.have.property('currency', 'eur');
          expect(response.body.transfer_data).to.have.property(
            'amount',
            117600
          );
          cy.wait(5000);
        });
      });

      it('Retrieve dispute details for ${card.type} ', () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/disputes?payment_intent=${Cypress.env('transactionId')}`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.data[0]).to.have.property(
            'status',
            'needs_response'
          ); // Check dispute status
          expect(response.body.data[0]).to.have.property(
            'reason',
            'product_not_received'
          );
          cy.task('log', response.body);
        });
      });
    });
  });
});

describe('Dispute - Inquiry', () => {
  testData.testCardsInquiry.forEach((dispute) => {
    describe(`Dispute- ${dispute.type}`, () => {
      it(`Create a Payment Method with ${dispute.type}`, () => {
        cy.request({
          method: 'POST',
          url: 'https://api.stripe.com/v1/payment_methods',
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': dispute.number,
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

      it(`Process a Payment Charge with ${dispute.type}`, () => {
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
              cardName: dispute.type,
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
          cy.task(
            'log',
            `Transaction ID for ${dispute.type}: ${transactionId}`
          );
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should retrieve transaction status with ${dispute.type}`, () => {
        cy.wait(3000);
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

      it(`Verify Payment on Stripe for ${dispute.type}`, () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/payment_intents/${Cypress.env('transactionId')}`, // Or /charges/{charge_id}
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property('id');
          cy.task('log', response.body);
          expect(response.body).to.have.property('status', 'succeeded');
          expect(response.body).to.have.property('amount', 120000);
          expect(response.body).to.have.property('currency', 'eur');
          expect(response.body.transfer_data).to.have.property(
            'amount',
            117600
          );
          cy.wait(5000);
        });
      });

      it('Retrieve dispute details for ${card.type} ', () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/disputes?payment_intent=${Cypress.env('transactionId')}`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.data[0]).to.have.property(
            'status',
            'warning_needs_response'
          ); // Check dispute status
          expect(response.body.data[0]).to.have.property(
            'reason',
            'fraudulent'
          );
          cy.task('log', response.body);
        });
      });
    });
  });
});

describe('Dispute - Warning', () => {
  testData.testCardsWarning.forEach((dispute) => {
    describe(`Dispute- ${dispute.type}`, () => {
      it(`Create a Payment Method with ${dispute.type}`, () => {
        cy.request({
          method: 'POST',
          url: 'https://api.stripe.com/v1/payment_methods',
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': dispute.number,
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

      it(`Process a Payment Charge with ${dispute.type}`, () => {
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
              cardName: dispute.type,
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
          cy.task(
            'log',
            `Transaction ID for ${dispute.type}: ${transactionId}`
          );
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should retrieve transaction status with ${dispute.type}`, () => {
        cy.wait(3000);
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

      it(`Verify Payment on Stripe for ${dispute.type}`, () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/payment_intents/${Cypress.env('transactionId')}`, // Or /charges/{charge_id}
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property('id');
          cy.task('log', response.body);
          expect(response.body).to.have.property('status', 'succeeded');
          expect(response.body).to.have.property('amount', 120000);
          expect(response.body).to.have.property('currency', 'eur');
          expect(response.body.transfer_data).to.have.property(
            'amount',
            117600
          );
          cy.wait(5000);
        });
      });

      it('Retrieve dispute details for ${card.type} ', () => {
        cy.request({
          method: 'GET',
          url: `https://api.stripe.com/v1/disputes?payment_intent=${Cypress.env('transactionId')}`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          cy.task('log', response.body);
          expect(response.status).to.eq(200);
        });
      });
    });
  });
});
