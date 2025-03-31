import testData from 'cypress/fixtures/test_data.json';

let paymentMethodId, transactionId, uniqueId, disputeId, accessToken;

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
            merchantId: 'M123',
            amount: 120000,
            merchantMobileNo: '94713579023',
            transactionType: 'CHARGE',
            paymentMethod: 'CARD',
            customerPhone: '3333',
            currency: 'EUR',
            cardData: {
              paymentMethodId: Cypress.env('paymentMethodId'),
              cardName: dispute.type,
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
            'CHARGE_UPDATE_SUCCEEDED'
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
          disputeId = response.body.data[0].id;
          cy.task('log', ` ${disputeId}`);
          Cypress.env('disputeId', disputeId);
        });
      });

      it(`Accept dispute for ${dispute.type}`, () => {
        cy.request({
          method: 'POST',
          url: `https://api.stripe.com/v1/disputes/${Cypress.env('disputeId')}/close`,
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
          cy.task('log', response.body);
          accessToken = response.body.access_token;
          cy.task('log', `access_token : ${accessToken}`);
          Cypress.env('accessToken', accessToken);
          cy.wait(500);
        });
      });

      it(`Verify Payment on salesforce`, () => {
        cy.wait(2000);
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
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
          cy.task('log', response.body);
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
              merchantId: 'M123',
              merchantMobileNo: '94713579023',
              amount: 120000,
              transactionType: 'CHARGE',
              paymentMethod: 'CARD',
              customerPhone: '3333',
              currency: 'EUR',
              cardData: {
                paymentMethodId: Cypress.env('paymentMethodId'),
                cardName: dispute.type,
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
              'CHARGE_UPDATE_SUCCEEDED'
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
              108000
            );
            cy.wait(5000);
          });
        });

        it(`Retrieve dispute details for ${dispute.type}`, () => {
          cy.request({
            method: 'GET',
            url: `https://api.stripe.com/v1/disputes?payment_intent=${Cypress.env('uniqueId')}`,
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
            cy.task('log', response.body);
            accessToken = response.body.access_token;
            cy.task('log', `access_token : ${accessToken}`);
            Cypress.env('accessToken', accessToken);
            cy.wait(500);
          });
        });

        it(`Verify Payment on salesforce`, () => {
          cy.wait(2000);
          cy.request({
            method: 'GET',
            url: `${Cypress.env('salesforceServiceUrl')}status__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
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
              'Fee__c',
              '12000'
            );
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
              merchantId: 'M123',
              merchantMobileNo: '94713579023',
              amount: 120000,
              transactionType: 'CHARGE',
              paymentMethod: 'CARD',
              customerPhone: '3333',
              currency: 'EUR',
              cardData: {
                paymentMethodId: Cypress.env('paymentMethodId'),
                cardName: dispute.type,
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
              'CHARGE_UPDATE_SUCCEEDED'
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
            cy.task('log', response.body);
            accessToken = response.body.access_token;
            cy.task('log', `access_token : ${accessToken}`);
            Cypress.env('accessToken', accessToken);
            cy.wait(500);
          });
        });

        it(`Verify Payment on salesforce`, () => {
          cy.wait(2000);
          cy.request({
            method: 'GET',
            url: `${Cypress.env('salesforceServiceUrl')}status__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
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
              'Fee__c',
              '12000'
            );
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
              merchantId: 'M123',
              merchantMobileNo: '94713579023',
              amount: 120000,
              transactionType: 'CHARGE',
              paymentMethod: 'CARD',
              customerPhone: '3333',
              currency: 'EUR',
              cardData: {
                paymentMethodId: Cypress.env('paymentMethodId'),
                cardName: dispute.type,
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
              'CHARGE_UPDATE_SUCCEEDED'
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
            cy.task('log', response.body);
            accessToken = response.body.access_token;
            cy.task('log', `access_token : ${accessToken}`);
            Cypress.env('accessToken', accessToken);
            cy.wait(500);
          });
        });

        it(`Verify Payment on salesforce`, () => {
          cy.wait(2000);
          cy.request({
            method: 'GET',
            url: `${Cypress.env('salesforceServiceUrl')}status__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
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
              'Fee__c',
              '12000'
            );
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
            cy.task('log', response.body);
          });
        });
      });
    });
  });
});
