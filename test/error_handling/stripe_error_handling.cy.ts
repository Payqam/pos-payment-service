import testData from 'cypress/fixtures/test_data.json';

let paymentMethodId, transactionId, uniqueId, accessToken, Id;

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
          expect(response.body.transfer_data).to.have.property(
            'amount',
            108000
          );
        });
      });

      it(`Generates a Salesforce Access Token`, () => {
        cy.wait(1500);
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

      it(`Verify Payment on salesforce`, () => {
        cy.wait(2000);
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
          Cypress.env('paymentMethodId', paymentMethodId);
          cy.wait(500);
        });
      });

      it(`Verify 502 response for ${card.title}`, () => {
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
          expect(response.status).to.eq(502);
          expect(response.body.message).to.include(card.decline_reason);
          transactionId = response.body.details.transactionId;
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should retrieve transaction status`, () => {
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
          expect(response.body.transaction.Item)
            .to.have.property('status')
            .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);

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
          expect(response.body.last_payment_error).to.have.property(
            'code',
            card.Error_Code__c
          );
          expect(response.body.last_payment_error).to.have.property(
            'message',
            card.decline_reason
          );
        });
      });

      it(`Generates a Salesforce Access Token`, () => {
        cy.wait(1500);
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

      it(`Verify Payment on salesforce`, () => {
        cy.wait(3500);
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0])
            .to.have.property('status__c')
            .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);
          Id = response.body.records[0].Id;
          Cypress.env('Id', Id);
        });
      });

      it(`Verify error on salesforce`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}Name,Error_Type__c,Transaction__c,Error_Source__c,Error_Message__c,Error_Code__c+FROM+Transaction_Error__c+WHERE+Transaction__c='${Cypress.env('Id')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'Error_Code__c',
            card.Error_Code__c
          );
          expect(response.body.records[0]).to.have.property(
            'Error_Message__c',
            card.decline_reason
          );
          expect(response.body.records[0]).to.have.property(
            'Error_Type__c',
            card.Error_Type__c
          );
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
          Cypress.env('paymentMethodId', paymentMethodId);
          cy.wait(500);
        });
      });

      it(`Verify 502 response for ${card.type}`, () => {
        cy.wait(3000);
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
          expect(response.status).to.eq(502);
          expect(response.body.message).to.include(card.decline_details);
          transactionId = response.body.details.transactionId;
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it(`Should retrieve transaction status`, () => {
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
          expect(response.body.transaction.Item)
            .to.have.property('status')
            .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);

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
          expect(response.body.last_payment_error).to.have.property(
            'code',
            'card_declined'
          );
          expect(response.body.last_payment_error).to.have.property(
            'message',
            'Your card was declined.'
          );
        });
      });

      it(`Generates a Salesforce Access Token`, () => {
        cy.wait(1500);
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

      it(`Verify Payment on salesforce`, () => {
        cy.wait(3500);
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0])
            .to.have.property('status__c')
            .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);
          Id = response.body.records[0].Id;
          Cypress.env('Id', Id);
        });
      });

      it(`Verify error on salesforce`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}Name,Error_Type__c,Transaction__c,Error_Source__c,Error_Message__c,Error_Code__c+FROM+Transaction_Error__c+WHERE+Transaction__c='${Cypress.env('Id')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'Error_Code__c',
            'card_declined'
          );
          expect(response.body.records[0]).to.have.property(
            'Error_Message__c',
            'Your card was declined.'
          );
          expect(response.body.records[0]).to.have.property(
            'Error_Type__c',
            'blocked'
          );
        });
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
          merchantId: 'M123',
          merchantMobileNo: '94713579023',
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
        expect(response.status).to.eq(502);
        expect(response.body.message).to.include(card.decline_details);
        transactionId = response.body.details.transactionId;
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it(`Should retrieve transaction status`, () => {
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
        expect(response.body.transaction.Item)
          .to.have.property('status')
          .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);

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
        expect(response.body.last_payment_error).to.have.property(
          'code',
          'incorrect_cvc'
        );
        expect(response.body.last_payment_error).to.have.property(
          'message',
          "Your card's security code is incorrect."
        );
      });
    });

    it(`Generates a Salesforce Access Token`, () => {
      cy.wait(1500);
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

    it(`Verify Payment on salesforce`, () => {
      cy.wait(3500);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0])
          .to.have.property('status__c')
          .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);
        Id = response.body.records[0].Id;
        Cypress.env('Id', Id);
      });
    });

    it(`Verify error on salesforce`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}Name,Error_Type__c,Transaction__c,Error_Source__c,Error_Message__c,Error_Code__c+FROM+Transaction_Error__c+WHERE+Transaction__c='${Cypress.env('Id')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'Error_Code__c',
          'incorrect_cvc'
        );
        expect(response.body.records[0]).to.have.property(
          'Error_Message__c',
          "Your card's security code is incorrect."
        );
        expect(response.body.records[0]).to.have.property(
          'Error_Type__c',
          'blocked'
        );
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
          merchantId: 'M123',
          merchantMobileNo: '94713579023',
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

    it(`Should retrieve transaction status with ${card.type}`, () => {
      cy.wait(4000);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Cypress.env('x-api-key'),
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
        expect(
          response.body.transaction.Item.chargeResponse.outcome
        ).to.have.property('risk_level', 'elevated');
        expect(
          response.body.transaction.Item.chargeResponse.outcome
        ).to.have.property('reason', 'elevated_risk_level');
        uniqueId = response.body.transaction.Item.uniqueId;
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

        expect(response.body).to.have.property('status', 'succeeded');
        expect(response.body).to.have.property('amount', 120000);
        expect(response.body).to.have.property('currency', 'eur');
        expect(response.body.transfer_data).to.have.property('amount', 108000);
      });
    });

    it(`Generates a Salesforce Access Token`, () => {
      cy.wait(1500);
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

    it(`Verify Payment on salesforce`, () => {
      cy.wait(2000);
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
        Id = response.body.records[0].Id;
        Cypress.env('Id', Id);
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
        Cypress.env('paymentMethodId', paymentMethodId);
        cy.wait(500);
      });
    });

    it(`Verify 502 response for ${card.type}`, () => {
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
        expect(response.status).to.not.eq(200);
        expect(response.status).to.eq(502);
        expect(response.body).to.have.property('error');
        expect(response.body.message).to.include(card.decline_details);
        transactionId = response.body.details.transactionId;
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it(`Should retrieve transaction status`, () => {
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
        expect(response.body.transaction.Item)
          .to.have.property('status')
          .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);

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
        expect(response.body.last_payment_error).to.have.property(
          'code',
          'incorrect_cvc'
        );
        expect(response.body.last_payment_error).to.have.property(
          'message',
          "Your card's security code is incorrect."
        );
      });
    });

    it(`Generates a Salesforce Access Token`, () => {
      cy.wait(1500);
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

    it(`Verify Payment on salesforce`, () => {
      cy.wait(3500);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0])
          .to.have.property('status__c')
          .oneOf(['CHARGE_FAILED', 'INTENT_REQUIRES_PAYMENT_METHOD']);
        Id = response.body.records[0].Id;
        Cypress.env('Id', Id);
      });
    });

    it(`Verify error on salesforce`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}Name,Error_Type__c,Transaction__c,Error_Source__c,Error_Message__c,Error_Code__c+FROM+Transaction_Error__c+WHERE+Transaction__c='${Cypress.env('Id')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'Error_Code__c',
          'incorrect_cvc'
        );
        expect(response.body.records[0]).to.have.property(
          'Error_Message__c',
          "Your card's security code is incorrect."
        );
        expect(response.body.records[0]).to.have.property(
          'Error_Type__c',
          'blocked'
        );
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
      });
    });
  });
});

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
        cy.wait(500);
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
      });
    });
  });
});
