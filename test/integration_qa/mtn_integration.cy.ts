import testData from '../../cypress/fixtures/mtn_test_data.json';

let transactionId, accessToken, uniqueId, accesstoken, externalId;
describe('MTN Payment Processing Tests', () => {
  testData.testData.forEach((test) => {
    describe('Validate Successful Payment Processing', () => {
      it('should process a payment', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('ServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('xApiKey')}`,
            'Content-Type': 'application/json',
          },
          body: {
            merchantId: 'MERCHANT_123',
            merchantMobileNo: test.merchant,
            amount: 100.12,
            customerPhone: test.payer,
            transactionType: 'PAYMENT',
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
          expect(['SUCCESSFUL', 'PENDING']).to.include(
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
          url: `${Cypress.env('ServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'x-api-key': `${Cypress.env('xApiKey')}`,
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
            'PENDING'
          );
          uniqueId = response.body.transaction.Item.uniqueId;
          cy.task('log', ` ${uniqueId}`);
          Cypress.env('uniqueId', uniqueId);
          cy.task('log', response.body);
        });
      });

      it('Generates an Access Token', () => {
        cy.request({
          method: 'POST',
          url: 'https://sandbox.momodeveloper.mtn.com/collection/token/',
          headers: {
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTN_COLLECTION_SUBSCRIPTION_KEY')}`,
            Authorization:
              'Basic ' +
              btoa(
                `${Cypress.env('MTN_COLLECTION_API_USER')}:${Cypress.env('MTN_COLLECTION_API_KEY')}`
              ),
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          accessToken = response.body.access_token;
          cy.task('log', accessToken);
          Cypress.env('accessToken', accessToken);
        });
      });

      it('Checks Transaction Status', () => {
        cy.request({
          method: 'GET',
          url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${Cypress.env('transactionId')}`,
          headers: {
            'X-Target-Environment': 'sandbox',
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTN_COLLECTION_SUBSCRIPTION_KEY')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          cy.task('log', response.body);
          expect(response.body).to.have.property(
            'payerMessage',
            'PayQAM payment request'
          );
          expect(response.body).to.have.property('status', 'SUCCESSFUL');
          externalId = response.body.externalId;
          cy.task('log', externalId);
          Cypress.env('externalId', externalId);
        });
      });

      describe('MTN MoMo Disbursement Flow', () => {
        it('should generate token', () => {
          cy.request({
            method: 'POST',
            url: 'https://sandbox.momodeveloper.mtn.com/disbursement/token/',
            headers: {
              'Ocp-Apim-Subscription-Key': `${Cypress.env('MTN_DISBURSEMENT_SUBSCRIPTION_KEY')}`,
              Authorization:
                'Basic ' +
                btoa(
                  `${Cypress.env('MTN_DISBURSEMENT_API_USER')}:${Cypress.env('MTN_DISBURSEMENT_API_KEY')}`
                ),
            },
          }).then((response) => {
            expect(response.status).to.eq(200);
            cy.task('log', response.body);
            accesstoken = response.body.access_token;
            cy.task('log', accesstoken);
            Cypress.env('accesstoken', accesstoken);
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
      url: `${Cypress.env('ServiceEndpoint')}/transaction/process/charge`,
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
