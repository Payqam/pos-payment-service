import testData from 'cypress/fixtures/test_data.json';

let paymentMethodId, transactionId, uniqueId;

describe('Negative Payment Scenarios - Card Validation', () => {
  const paymentApiUrl = `${Cypress.env('paymentApiUrl')}payment_methods`;
  const stripeApiKey = Cypress.env('stripeApiKey');

  testData.invalidCardTests.forEach((test) => {
    it(`Verify 402 response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: paymentApiUrl,
        headers: {
          Authorization: `Bearer ${stripeApiKey}`,
        },
        form: true,
        failOnStatusCode: false,
        body: {
          type: 'card',
          'card[number]': test.body['card[number]'] || '4242424242424242',
          'card[exp_month]': test.body['card[exp_month]'] || '12',
          'card[exp_year]': test.body['card[exp_year]'] || '2025',
          'card[cvc]': test.body['card[cvc]'] || '123',
        },
      }).then((response) => {
        expect(response.status).to.eq(402);
        expect(response.status).to.not.eq(200);
        expect(response.body).to.have.property('error');
        expect(response.body.error).to.have.property('code', test.code);
        expect(response.body.error).to.have.property('message', test.message);
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});

describe('Edge Cases Payment Scenarios - Card Validation', () => {
  const paymentApiUrl = `${Cypress.env('paymentApiUrl')}payment_methods`;
  const stripeApiKey = Cypress.env('stripeApiKey');

  testData.EdgeCaseTestCard.forEach((test) => {
    describe(` Card Validation for ${test.title} `, () => {
      it(`Verify API response for ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: paymentApiUrl,
          headers: {
            Authorization: `Bearer ${stripeApiKey}`,
          },
          form: true,
          failOnStatusCode: false,
          body: {
            type: 'card',
            'card[number]': '4242424242424242',
            'card[exp_month]': '12',
            'card[exp_year]': '2025',
            'card[cvc]': test['card[cvc]'],
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
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: 'visa',
              destinationId: 'acct_1QmXUNPsBq4jlflt',
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
          expect(response.body.transfer_data).to.have.property(
            'amount',
            108000
          );
        });
      });
    });
  });
});

describe('Empty fields and unsupported Payment Scenarios - Card Validation', () => {
  const paymentApiUrl = `${Cypress.env('paymentApiUrl')}payment_methods`;
  const stripeApiKey = Cypress.env('stripeApiKey');

  testData.emptyFieldTest.forEach((test) => {
    it(`Verify 400 response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: paymentApiUrl,
        headers: {
          Authorization: `Bearer ${stripeApiKey}`,
        },
        form: true,
        failOnStatusCode: false,
        body: {
          'card[type]': test.body['card[type]'] || 'card',
          'card[number]': test.body['card[number]'] || '4242424242424242',
          'card[exp_month]': test.body['card[exp_month]'] || '12',
          'card[exp_year]': test.body['card[exp_year]'] || '2025',
          'card[cvc]': test.body['card[cvc]'] || '123',
        },
      }).then((response) => {
        expect(response.status).to.not.eq(200);
        expect(response.status).to.eq(400);
        expect(response.body).to.have.property('error');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});

describe('Decline Card Payment', () => {
  testData.declineCard.forEach((card) => {
    describe(`Verify Decline Payment -  ${card.title}`, () => {
      it(`Create a Payment Method with ${card.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentApiUrl')}payment_methods`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': card.card_number,
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

      it(`Verify 500 response for ${card.title}`, () => {
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
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: card.title,
              destinationId: 'acct_1QmXUNPsBq4jlflt',
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
          expect(response.status).to.eq(500);
          expect(response.body.message).to.include(card.decline_reason);
        });
      });
    });
  });

  testData.declineCardIncorrectNumber.forEach((card) => {
    describe(`Verify Decline Payment -  ${card.title}`, () => {
      it(`verify 402 response for ${card.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentApiUrl')}payment_methods`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': card.card_number,
            'card[exp_month]': '12',
            'card[exp_year]': '2025',
            'card[cvc]': '123',
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(402);
          cy.task('log', response.body);
          cy.wait(500);
        });
      });
    });
  });
});

describe('Fraud Prevention Card Payment', () => {
  testData.fraudPrevention.forEach((card) => {
    describe(`Verify Fraud Payment -  ${card.type}`, () => {
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

      it(`Verify 500 response for ${card.type}`, () => {
        cy.wait(3000);
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
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: card.type,
              destinationId: 'acct_1QmXUNPsBq4jlflt',
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
          expect(response.status).to.eq(500);
          expect(response.body.message).to.include(card.decline_details);
        });
      });
    });
  });

  testData.CVCCheckFails.forEach((card) => {
    describe(`Verify Fraud Payment -  ${card.type}`, () => {
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

      it(`Verify 500 response for ${card.type}`, () => {
        cy.wait(3700);
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
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: card.type,
              destinationId: 'acct_1QmXUNPsBq4jlflt',
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
          expect(response.status).to.eq(500);
          expect(response.body.message).to.include(card.decline_details);
        });
      });
    });
  });

  testData.elevatedRisk.forEach((card) => {
    describe(`Verify Fraud Payment -  ${card.type}`, () => {
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

      it(`Verify 200 response for ${card.type}`, () => {
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
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: card.type,
              destinationId: 'acct_1QmXUNPsBq4jlflt',
            },
            metaData: {
              deviceId: 'device_identifier',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
          },
        }).then((response) => {
          cy.task('log', response.body);
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

      it(`Should retrieve transaction status with ${card.type}`, () => {
        cy.wait(3000);
        cy.request({
          method: 'GET',
          url: `${Cypress.env('paymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': Cypress.env('x-api-key'),
          },
        }).then((response) => {
          cy.task('log', response.body);
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property(
            'message',
            'Transaction retrieved successfully'
          );
          expect(response.body.transaction.Item).to.have.property(
            'status',
            'CHARGE_UPDATED'
          );
          expect(
            response.body.transaction.Item.paymentProviderResponse.outcome
          ).to.have.property('risk_level', 'elevated');
          uniqueId = response.body.transaction.Item.uniqueId;
          cy.task('log', ` ${uniqueId}`);
          Cypress.env('uniqueId', uniqueId);
        });
        cy.wait(500);
      });

      it(`Verify Payment on Stripe for ${card.type}`, () => {
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
          expect(response.body.transfer_data).to.have.property(
            'amount',
            117600
          );
        });
      });
    });
  });

  testData.CVCCheckFails.forEach((card) => {
    describe(`Verify Fraud Payment -  ${card.type}`, () => {
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
          expect(response.status).to.eq(500);
          expect(response.body).to.have.property('id');
          paymentMethodId = response.body.id;
          cy.task('log', response.body);
          cy.task('log', paymentMethodId);
          Cypress.env('paymentMethodId', paymentMethodId);
          cy.wait(500);
        });
      });

      it(`Verify 500 response for ${card.type}`, () => {
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
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: card.type,
              destinationId: 'acct_1QmXUNPsBq4jlflt',
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
          expect(response.status).to.not.eq(200);
          expect(response.status).to.eq(500);
          expect(response.body).to.have.property('error');
          expect(response.body.details).to.include(card.decline_details);
        });
      });
    });
  });

  testData.fraud_Address.forEach((card) => {
    describe(`Verify Address Check Fail Payment -  ${card.type}`, () => {
      it(`Verify 400 response for ${card.type}`, () => {
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
            'card[address_zip]': '12345',
            'card[address_line1]': 'Invalid',
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.not.eq(200);
          expect(response.status).to.eq(400);
          expect(response.body).to.have.property('error');
          expect(response.body.error.message).to.include(
            'Received unknown parameters'
          );
          expect(response.body.error.message).to.include('address_line1');
          expect(response.body.error.message).to.include('address_zip');
          cy.task('log', response.body);
        });
      });
    });
  });
});


describe(`Verify error for already completed payment`, () => {
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
      cy.task('log', `Payment Method ID: ${paymentMethodId}`);
      Cypress.env('paymentMethodId', paymentMethodId);
    });
  });

  it(`Process a Payment Charge in`, () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('x-api-key')}`,
      },
      body: {
        merchantId: 'unique_merchant_identifier',
        amount: 100000,
        transactionType: 'CHARGE',
        paymentMethod: 'CARD',
        customerPhone: '3333',
        currency: 'USD',
        cardData: {
          paymentMethodId: Cypress.env('paymentMethodId'),
          cardName: 'visa',
          destinationId: 'acct_1QmXUNPsBq4jlflt',
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
      expect(response.body.transactionDetails).to.have.property(
        'transactionId'
      );
      expect(response.body.transactionDetails).to.have.property(
        'status',
        'succeeded'
      );
      transactionId = response.body.transactionDetails.transactionId;
      Cypress.env('transactionId', transactionId);
    });
  });

  it(`Verify 500 for process a Payment Charge already processed payment`, () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('x-api-key')}`,
      },
      body: {
        merchantId: 'unique_merchant_identifier',
        amount: 100000,
        transactionType: 'CHARGE',
        paymentMethod: 'CARD',
        customerPhone: '3333',
        currency: 'USD',
        cardData: {
          paymentMethodId: Cypress.env('paymentMethodId'),
          cardName: 'visa',
          destinationId: 'acct_1QmXUNPsBq4jlflt',
        },
        metaData: {
          deviceId: 'device_identifier',
          location: 'transaction_location',
          timestamp: 'transaction_timestamp',
        },
      },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(500);
      cy.task('log', response.body);
      expect(response.body).to.have.property(
        'message',
        'The provided PaymentMethod was previously used with a PaymentIntent without Customer attachment, shared with a connected account without Customer attachment, or was detached from a Customer. It may not be used again. To use a PaymentMethod multiple times, you must attach it to a Customer first.'
      );
      expect(response.body).to.have.property('error', 'SYSTEM_ERROR');
    });
  });
});
