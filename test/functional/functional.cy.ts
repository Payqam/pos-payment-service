import testData from '../../cypress/fixtures/test_data.json';

let paymentMethodId, transactionId, uniqueId, accessToken;
describe('Payment Method Identification Tests MTN and Orange', () => {
  testData.PaymentMethodVerification.forEach((test) => {
    describe(`Payment Method Identification Tests with ${test.title}`, () => {
      it(`Verify payment request with ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('x-api-key')}`,
          },
          body: {
            merchantId: '691654524',
            merchantMobileNo: '691654524',
            amount: 120000,
            transactionType: 'CHARGE',
            paymentMethod: test.paymentMethod,
            customerPhone: '699944974',
            currency: 'EUR',
            cardData: {},
            metaData: {
              deviceId: 'deviceID',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(test.status);
          expect(response.body).to.have.property('message', test.message);
        });
      });
    });
  });

  describe(`Payment Method Identification without paymentMethod`, () => {
    it(`Verify payment request without paymentMethod`, () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('x-api-key')}`,
        },
        body: {
          merchantId: '691654524',
          merchantMobileNo: '691654524',
          amount: 120000,
          transactionType: 'CHARGE',
          customerPhone: '699944974',
          currency: 'EUR',
          cardData: {},
          metaData: {
            deviceId: 'deviceID',
            location: 'transaction_location',
            timestamp: 'transaction_timestamp',
          },
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body).to.have.property(
          'message',
          'Invalid request body'
        );
      });
    });
  });
});

//not able to test multi currencies in MTN and Orange.............

describe('Payment Method Identification Tests for Stripe', () => {
  testData.PaymentMethodVerificationStripe.forEach((test) => {
    describe(`Verify ${test.status} for  ${test.title}`, () => {
      it(`Create a Payment Method for ${test.title}`, () => {
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
          Cypress.env('paymentMethodId', paymentMethodId);
          cy.wait(500);
        });
      });
      it(`Verify payment request with ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('x-api-key')}`,
          },
          body: {
            merchantId: 'M123',
            merchantMobileNo: '94713579023',
            amount: 120000,
            transactionType: 'CHARGE',
            paymentMethod: test.paymentMethod,
            customerPhone: '3333',
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: 'Visa',
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
          expect(response.status).to.eq(test.status);
          expect(response.body)
            .to.have.property('message')
            .that.includes(test.message);
        });
      });
    });
  });

  describe(`Verify payment request without paymentMethod`, () => {
    it(`Create a Payment Method for`, () => {
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
        Cypress.env('paymentMethodId', paymentMethodId);
        cy.wait(500);
      });
    });

    it(`Verify payment request without paymentMethod`, () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('x-api-key')}`,
        },
        body: {
          merchantId: 'M123',
          merchantMobileNo: '94713579023',
          amount: 120000,
          transactionType: 'CHARGE',
          customerPhone: '3333',
          currency: 'EUR',
          cardData: {
            paymentMethodId: Cypress.env('paymentMethodId'),
            cardName: 'Visa',
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
        expect(response.status).to.eq(400);
        expect(response.body).to.have.property(
          'message',
          'Invalid request body'
        );
      });
    });
  });
});

testData.currency.forEach((card) => {
  describe('Stripe Payment Processing Tests Multi Currency', () => {
    describe(`Validate Successful Payment Processing - ${card.currency}`, () => {
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
          Cypress.env('paymentMethodId', paymentMethodId);
        });
      });

      it(`Process a Payment Charge in ${card.currency}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('x-api-key')}`,
          },
          body: {
            merchantId: 'unique_merchant_identifier',
            amount: card.amount,
            transactionType: 'CHARGE',
            paymentMethod: 'CARD',
            customerPhone: '3333',
            currency: card.currency,
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

      it(`Retrieve transaction status for ${card.currency}`, () => {
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
          expect(response.body).to.have.property(
            'message',
            'Transaction retrieved successfully'
          );
          expect(response.body.transaction.Item).to.have.property(
            'status',
            'CHARGE_UPDATE_SUCCEEDED'
          );
          uniqueId = response.body.transaction.Item.uniqueId;
          Cypress.env('uniqueId', uniqueId);
        });
      });

      it(`Verify Payment on Stripe for ${card.currency}`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('paymentApiUrl')}payment_intents/${Cypress.env('uniqueId')}`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeSecretKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body).to.have.property('status', 'succeeded');
          expect(response.body).to.have.property('amount', card.amount);
          expect(response.body).to.have.property(
            'currency',
            card.currency.toLowerCase()
          );
        });
      });

      it(`Generates a Salesforce Access Token`, () => {
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
          accessToken = response.body.access_token;
          Cypress.env('accessToken', accessToken);
          cy.wait(500);
        });
      });

      it(`Verify Payment on salesforce for ${card.currency} payment`, () => {
        cy.wait(2500);
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,fee__c,Currency__c,merchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'CHARGE_UPDATE_SUCCEEDED'
          );
          expect(response.body.records[0]).to.have.property(
            'currency__c',
            card.currency
          );
        });
      });
    });
  });
});
