describe('Successful Payment -  Cards by Country-Americas', () => {
  (
    Cypress.env('testCardsbyAmericas') as { type: string; number: string }[]
  ).forEach((card) => {
    let paymentMethodId, transactionId;

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
        cy.task('log', `Transaction ID for ${card.type}: ${transactionId}`);
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it(`Should retrieve transaction status with ${card.type}`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentServiceEndpoint')}transaction/status/?transactionId=${Cypress.env('transactionId')}`,
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
      });
      cy.wait(500);
    });

    it(`Verify Payment on Stripe for ${card.type}`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentApiUrl')}payment_intents/${Cypress.env('transactionId')}`, // Or /charges/{charge_id}
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        cy.task('log', response.body);

        // Validate the payment status and details
        expect(response.body).to.have.property('status', 'succeeded');
        expect(response.body).to.have.property('amount', 120000);
        expect(response.body).to.have.property('currency', 'eur');
        expect(response.body.transfer_data).to.have.property('amount', 117600);
      });
    });
  });
});

describe('Successful Payment -  Cards by Country-Europe & MiddleEast', () => {
  (
    Cypress.env('testCardsbyEurope&MiddleEast') as {
      type: string;
      number: string;
    }[]
  ).forEach((card) => {
    let paymentMethodId, transactionId;

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
        cy.task('log', `Transaction ID for ${card.type}: ${transactionId}`);
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it(`Should retrieve transaction status with ${card.type}`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentServiceEndpoint')}transaction/status/?transactionId=${Cypress.env('transactionId')}`,
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
      });
      cy.wait(500);
    });
  });
});

describe('Successful Payment -  Cards by Country-Asia Pacific', () => {
  (
    Cypress.env('testCardsbyAsiaPacific') as { type: string; number: string }[]
  ).forEach((card) => {
    let paymentMethodId, transactionId;

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
        cy.task('log', `Transaction ID for ${card.type}: ${transactionId}`);
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it(`Should retrieve transaction status with ${card.type}`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentServiceEndpoint')}transaction/status/?transactionId=${Cypress.env('transactionId')}`,
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
      });
      cy.wait(500);
    });

    it(`Verify Payment on Stripe for ${card.type}`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentApiUrl')}payment_intents/${Cypress.env('transactionId')}`, // Or /charges/{charge_id}
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        cy.task('log', response.body);

        // Validate the payment status and details
        expect(response.body).to.have.property('status', 'succeeded');
        expect(response.body).to.have.property('amount', 120000);
        expect(response.body).to.have.property('currency', 'eur');
        expect(response.body.transfer_data).to.have.property('amount', 117600);
      });
    });
  });
});

describe('Successful Payment -  Cards by Brand', () => {
  (
    Cypress.env('testCardsRequiresActions') as {
      type: string;
      number: string;
    }[]
  ).forEach((card) => {
    let paymentMethodId, transactionId;

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
          'requires_action'
        );

        transactionId = response.body.transactionDetails.transactionId;
        cy.task('log', `Transaction ID for ${card.type}: ${transactionId}`);
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it(`Verify Payment on Stripe for ${card.type}`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentApiUrl')}payment_intents/${Cypress.env('transactionId')}`, // Or /charges/{charge_id}
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        cy.task('log', response.body);

        // Validate the payment status and details
        expect(response.body).to.have.property('status', 'succeeded');
        expect(response.body).to.have.property('amount', 120000);
        expect(response.body).to.have.property('currency', 'eur');
        expect(response.body.transfer_data).to.have.property('amount', 117600);
      });
    });
  });
});
