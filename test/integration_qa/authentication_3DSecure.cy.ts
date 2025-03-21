import testData from 'cypress/fixtures/test_data.json';
let paymentMethodId, transactionId, uniqueId, accessToken;

describe('Authentication and 3D Secure', () => {
  testData.Authentication_3DSecure.forEach((card) => {
    describe(`Verify Successful Payment -  ${card.type}`, () => {
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

      it(`Process a Payment Charge and verify required Action Status with ${card.type}`, () => {
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
            currency: 'eur',
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
            card.outcome
          );

          transactionId = response.body.transactionDetails.transactionId;
          cy.task('log', `Transaction ID for ${card.type}: ${transactionId}`);
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should retrieve transaction status with ${card.type}`, () => {
        cy.wait(4000);
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
          expect(response.body.transaction.Item.status).to.include(
            card.outcome
          );
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

          expect(response.body).to.have.property('status', 'requires_action');
          expect(response.body).to.have.property('amount', 120000);
          expect(response.body).to.have.property('currency', 'eur');
          expect(response.body.transfer_data).to.have.property(
            'amount',
            108000
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
          cy.task('log', response.body);
          accessToken = response.body.access_token;
          cy.task('log', `access_token : ${accessToken}`);
          Cypress.env('accessToken', accessToken);
          cy.wait(500);
        });
      });

      it(`Verify Payment on salesforce for ${card.type} payment`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,merchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'requires_action'
          );
          expect(response.body.records[0]).to.have.property('Fee__c', '12000');
          cy.task('log', response.body);
        });
      });
    });
  });

  testData.SecureSuccess.forEach((card) => {
    describe(`Verify Successful Payment- Secure Success -  ${card.type}`, () => {
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
            currency: 'eur',
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

      it(`Should retrieve transaction status with INTENT_CREATED for ${card.type}`, () => {
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
          expect(response.body.transaction.Item.status).to.include(
            card.outcome
          );
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
            108000
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
          cy.task('log', response.body);
          accessToken = response.body.access_token;
          cy.task('log', `access_token : ${accessToken}`);
          Cypress.env('accessToken', accessToken);
          cy.wait(500);
        });
      });

      it(`Verify Payment on salesforce for ${card.type} payment`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,merchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'CHARGE_UPDATED'
          );
          expect(response.body.records[0]).to.have.property('Fee__c', '12000');
          cy.task('log', response.body);
        });
      });
    });
  });
});
