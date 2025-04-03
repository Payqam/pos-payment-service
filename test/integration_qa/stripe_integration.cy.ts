import testData from '../../cypress/fixtures/test_data.json';

let paymentMethodId, transactionId, uniqueId, accessToken;

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
          merchantId: 'M123',
          amount: 120000,
          merchantMobileNo: '94713579023',
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
        expect(response.body).to.have.property(
          'message',
          'Transaction retrieved successfully'
        );
        expect(response.body.transaction.Item).to.have.property(
          'status',
          'CHARGE_UPDATE_SUCCEEDED'
        );
        expect(response.body.transaction.Item).to.have.property(
          'amount',
          120000
        );
        expect(response.body.transaction.Item).to.have.property('fee', 12000);
        expect(
          response.body.transaction.Item.chargeResponse.transfer_data
        ).to.have.property('amount', 108000);

        uniqueId = response.body.transaction.Item.uniqueId;
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
        expect(response.body).to.have.property('status', 'succeeded');
        expect(response.body).to.have.property('amount', 120000);
        expect(response.body).to.have.property('currency', 'eur');
        expect(response.body.transfer_data).to.have.property('amount', 108000);
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

    it(`Verify Payment on salesforce for  payment`, () => {
      cy.wait(4000);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'CHARGE_UPDATE_SUCCEEDED'
        );
        expect(response.body.records[0]).to.have.property('Fee__c', '12000');
        expect(response.body.records[0]).to.have.property(
          'amount__c',
          '108000'
        );
        expect(response.body.records[0]).to.have.property(
          'Net_Amount__c',
          '120000'
        );
        expect(response.body.records[0]).to.have.property(
          'MerchantId__c',
          'M123'
        );
        expect(response.body.records[0]).to.have.property(
          'Merchant_Phone__c',
          '94713579023'
        );
        expect(response.body.records[0]).to.have.property(
          'Customer_Phone__c',
          '3333'
        );
        expect(response.body.records[0]).to.have.property(
          'ServiceType__c',
          'Stripe'
        );
      });
    });
  });
});

describe('Validate Duplicate Requests Payment Processing', () => {
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
          Cypress.env('paymentMethodId', paymentMethodId);
          cy.wait(500);
        });
      });

      it(`Verify 502 Response for Duplicate Requests`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('x-api-key')}`,
            'Idempotency-Key': idempotencyKey,
          },
          body: {
            merchantId: 'M123',
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
              merchantId: 'M123',
              merchantMobileNo: '94713579023',
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
            failOnStatusCode: false,
          }).then((duplicateResponse) => {
            expect(duplicateResponse.status).to.eq(502);
            expect(duplicateResponse.body).to.have.property(
              'error',
              'PROVIDER_ERROR'
            );
            expect(duplicateResponse.body).to.have.property(
              'errorCode',
              'STRIPE_ERROR'
            );
            expect(duplicateResponse.body).to.have.property(
              'message',
              'The provided PaymentMethod was previously used with a PaymentIntent without Customer attachment, shared with a connected account without Customer attachment, or was detached from a Customer. It may not be used again. To use a PaymentMethod multiple times, you must attach it to a Customer first.'
            );
          });
        });
      });
    });
  });
});

describe('Validate Request with Invalid API Token', () => {
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
      Cypress.env('paymentMethodId', paymentMethodId);
      cy.wait(500);
    });
  });

  it('should return 403 for invalid API token', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
      headers: {
        'x-api-key': `${Cypress.env('InvalidXApiKey')}`,
        'Content-Type': 'application/json',
      },
      failOnStatusCode: false,
      body: {
        merchantId: 'M123',
        amount: 120000,
        merchantMobileNo: '94713579023',
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
      expect(response.status).to.eq(403);
      expect(response.body).to.have.property('message', 'Forbidden');
    });
  });
});
