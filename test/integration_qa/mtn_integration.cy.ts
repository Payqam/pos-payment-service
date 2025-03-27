import testData from '../../cypress/fixtures/mtn_test_data.json';

let transactionId, accessToken, uniqueId, authtoken, externalId;
describe('MTN Payment Processing Tests', () => {
  testData.testData.forEach((test) => {
    describe('Validate Successful Payment Processing', () => {
      it('should process a payment', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
          body: {
            merchantId: 'M123',
            merchantMobileNo: test.merchant,
            amount: 100,
            customerPhone: test.payer,
            transactionType: 'CHARGE',
            paymentMethod: 'MTN',
            currency: 'EUR',
            metaData: {
              reference: 'ORDER_123',
              description: 'Payment for order #123',
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
          expect('PAYMENT_REQUEST_CREATED').to.include(
            response.body.transactionDetails.status
          );

          transactionId = response.body.transactionDetails.transactionId;
          cy.task('log', `Transaction ID : ${transactionId}`);
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it('should get transaction status', () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
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
            'DISBURSEMENT_SUCCESSFUL'
          );
          uniqueId = response.body.transaction.Item.uniqueId;
          cy.task('log', ` ${uniqueId}`);
          Cypress.env('uniqueId', uniqueId);
          externalId =
            response.body.transaction.Item.paymentResponse.externalId;
          cy.task('log', ` ${externalId}`);
          Cypress.env('externalId', externalId);
          cy.task('log', response.body);
        });
      });

      it('Generates an MTN Access Token', () => {
        cy.request({
          method: 'POST',
          url: 'https://sandbox.momodeveloper.mtn.com/collection/token/',
          headers: {
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNCollectionSubscriptionKey')}`,
            Authorization:
              'Basic ' +
              btoa(
                `${Cypress.env('MTNCollectionApiUser')}:${Cypress.env('MTNCollectionApiKey')}`
              ),
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          accessToken = response.body.access_token;
          cy.task('log', accessToken);
          Cypress.env('accessToken', accessToken);
        });
      });

      it('Checks Transaction Status from MTN', () => {
        cy.request({
          method: 'GET',
          url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${Cypress.env('transactionId')}`,
          headers: {
            'X-Target-Environment': 'sandbox',
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNCollectionSubscriptionKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          cy.task('log', response.body);
          expect(response.body).to.have.property('status', 'SUCCESSFUL');
        });
      });

      describe('MTN MoMo Disbursement Flow', () => {
        it('should generate token', () => {
          cy.request({
            method: 'POST',
            url: 'https://sandbox.momodeveloper.mtn.com/disbursement/token/',
            headers: {
              'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNDisbursementSubscriptionKey')}`,
              Authorization:
                'Basic ' +
                btoa(
                  `${Cypress.env('MTNDisbursementApiUser')}:${Cypress.env('MTNDisbursementApiKey')}`
                ),
            },
          }).then((response) => {
            expect(response.status).to.eq(200);
            cy.task('log', response.body);
            authtoken = response.body.access_token;
            cy.task('log', authtoken);
            Cypress.env('authtoken', authtoken);
          });
        });

        it('Check Disbursement Status', () => {
          cy.request({
            method: 'GET',
            url: `https://sandbox.momodeveloper.mtn.com/disbursement/v1_0/transfer/${Cypress.env('uniqueId')}`,
            headers: {
              'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNDisbursementSubscriptionKey')}`,
              'X-Target-Environment': `${Cypress.env('MTNTargetEnvironment')}`,
              Authorization: `Bearer ${Cypress.env('authtoken')}`,
              'Content-Type': 'application/json',
            },
          }).then((response) => {
            expect(response.status).to.eq(200);
            cy.task('log', response.body);
            expect(response.body).to.have.property('status', 'SUCCESSFUL');
            expect(response.body).to.have.property('amount', '97.5');
          });
        });
      });

      describe('Verify Payment on Salesforce', () => {
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
            url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
            headers: {
              Authorization: `Bearer ${Cypress.env('accessToken')}`,
            },
          }).then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.records[0]).to.have.property(
              'status__c',
              'DISBURSEMENT_SUCCESSFUL'
            );
            expect(response.body.records[0]).to.have.property('Fee__c', '2.5');
            expect(response.body.records[0]).to.have.property(
              'amount__c',
              '97.5'
            );
            expect(response.body.records[0]).to.have.property(
              'Net_Amount__c',
              '100'
            );
            expect(response.body.records[0]).to.have.property(
              'MerchantId__c',
              'M123'
            );
            expect(response.body.records[0]).to.have.property(
              'Merchant_Phone__c',
              test.merchant
            );
            expect(response.body.records[0]).to.have.property(
              'Customer_Phone__c',
              test.payer
            );
            expect(response.body.records[0]).to.have.property(
              'ServiceType__c',
              'MTN MOMO'
            );
            cy.task('log', response.body);
          });
        });
      });
    });
  });
});

describe('Validate Request with Invalid API Token', () => {
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
        amount: 1000,
        paymentMethod: 'MTN',
        token: 'invalid',
      },
    }).then((response) => {
      expect(response.status).to.eq(403);
      cy.task('log', response.body);
    });
  });
});
