import testData from '../../cypress/fixtures/mtn_test_data.json';
let transactionId, accessToken, uniqueId, externalId;

describe('MTN Payment Processing Tests - Negative Scenarios', () => {
  describe('Verify payment request with Invalid details', () => {
    it('should return 400 Bad Request when payer details are missing', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('ServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('InvalidApiKey')}`,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          merchantId: 'MERCHANT_123',
          merchantMobileNo: '94767987987',
          customerPhone: '94713579023',
          amount: 100.12,
          transactionType: 'PAYMENT',
          paymentMethod: 'MTN',
          metaData: {
            reference: 'ORDER_123',
            description: 'Payment for order #123',
          },
        },
      }).then((response) => {
        expect(response.status).to.eq(403);
        cy.task('log', response.body);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Forbidden');
      });
    });

    testData.invalidData.forEach((test) => {
      it(`should return ${test.expectedStatus} Bad Request when using ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('ServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('xApiKey')}`,
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
          body: {
            merchantId: 'MERCHANT_123',
            merchantMobileNo:
              test.body['mtn[merchantMobileNo]'] || '94767987987',
            amount: test.body['mtn[amount]'] || 1000,
            customerPhone: test.body['mtn[customerPhone]'] || '94786987543',
            transactionType: 'PAYMENT',
            paymentMethod: 'MTN',
            currency: 'EUR',
            metaData: {
              reference: 'ORDER_123',
              description: 'Payment for order #123',
            },
          },
        }).then((response) => {
          expect(response.status).to.eq(test.expectedStatus);
          cy.task('log', response.body);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include(test.expectedMessage);
        });
      });
    });
  });
  describe('Verify transaction status with Invalid details', () => {
    testData.invalidId.forEach((test) => {
      it(`should return ${test.expectedStatus} Bad Request when using ${test.title}`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('ServiceEndpoint')}/transaction/status/?transactionId=${test.transactionId}`,
          headers: {
            'x-api-key': `${Cypress.env('xApiKey')}`,
            'Content-Type': 'application/json',
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
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
          url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${test.transactionId}`,
          headers: {
            'X-Target-Environment': 'sandbox',
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTN_COLLECTION_SUBSCRIPTION_KEY')}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(test.expectedStatus);
        });
      });
    });
  });
});

describe('MTN Request to Pay Payer Tests - Negative Scenarios', () => {
  testData.requestToPayPayer.forEach((test) => {
    describe(`Verify payment request for ${test.title}`, () => {
      it(`should process a payment`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('ServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('xApiKey')}`,
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
          body: {
            merchantId: 'MERCHANT_123',
            merchantMobileNo: '94767987987',
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

      it('Checks Transaction Status of FAILED', () => {
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
          expect(response.body).to.have.property('reason', test.reason);
          expect(response.body).to.have.property('status', 'FAILED');
        });
      });
    });
  });
});

describe('MTN Account Holder Active Party Code Tests - Negative Scenarios', () => {
  testData.AccountHolderActivePartyCode.forEach((test) => {
    describe(`Account Holder Active Party Code Tests for ${test.title}`, () => {
      it('should get transaction status', () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('ServiceEndpoint')}/transaction/status/?transactionId=${test.transactionId}`,
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

      it(`Checks Transaction Status for ${test.title}`, () => {
        cy.request({
          method: 'GET',
          url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${test.transactionId}`,
          headers: {
            'X-Target-Environment': 'sandbox',
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTN_COLLECTION_SUBSCRIPTION_KEY')}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(404);
          cy.task('log', response.body);
          expect(response.body).to.have.property(
            'message',
            'Requested resource was not found.'
          );
        });
      });
    });
  });
});

// describe('MTN Payment Processing Tests', () => {
//     describe('Validate Successful Payment Processing', () => {
//       it('should process a payment', () => {
//         cy.request({
//           method: 'POST',
//           url: `${Cypress.env('ServiceEndpoint')}/transaction/process/charge`,
//           headers: {
//             'x-api-key': `${Cypress.env('xApiKey')}`,
//             'Content-Type': 'application/json',
//           },
//           body: {
//             merchantId: 'MERCHANT_123',
//             merchantMobileNo: test.merchant,
//             amount: 100.12,
//             customerPhone: test.payer,
//             transactionType: 'PAYMENT',
//             paymentMethod: 'MTN',
//             currency: 'EUR',
//             metaData: {
//               reference: 'ORDER_123',
//               description: 'Payment for order #123',
//             },
//           },
//         }).then((response) => {
//           expect(response.status).to.eq(200);
//           cy.task('log', response.body);
//           expect(response.body).to.have.property(
//             'message',
//             'Payment processed successfully'
//           );
//           expect(response.body).to.have.property('transactionDetails');
//           expect(response.body.transactionDetails).to.have.property(
//             'transactionId'
//           );
//           expect(['SUCCESSFUL', 'PENDING']).to.include(
//             response.body.transactionDetails.status
//           );
//
//           transactionId = response.body.transactionDetails.transactionId;
//           cy.task('log', `Transaction ID : ${transactionId}`);
//           Cypress.env('transactionId', transactionId);
//           cy.wait(500);
//         });
//       });
//
//       it('should get transaction status', () => {
//         cy.request({
//           method: 'GET',
//           url: `${Cypress.env('ServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
//           headers: {
//             'x-api-key': `${Cypress.env('xApiKey')}`,
//             'Content-Type': 'application/json',
//           },
//         }).then((response) => {
//           expect(response.status).to.eq(200);
//           cy.task('log', response.body);
//           expect(response.body).to.have.property(
//             'message',
//             'Transaction retrieved successfully'
//           );
//           expect(response.body.transaction.Item).to.have.property(
//             'status',
//             'PENDING'
//           );
//           uniqueId = response.body.transaction.Item.uniqueId;
//           cy.task('log', ` ${uniqueId}`);
//           Cypress.env('uniqueId', uniqueId);
//           cy.task('log', response.body);
//         });
//       });
//
//       it('Generates an Access Token', () => {
//         cy.request({
//           method: 'POST',
//           url: 'https://sandbox.momodeveloper.mtn.com/collection/token/',
//           headers: {
//             'Ocp-Apim-Subscription-Key': `${Cypress.env('MTN_COLLECTION_SUBSCRIPTION_KEY')}`,
//             Authorization:
//               'Basic ' +
//               btoa(
//                 `${Cypress.env('MTN_COLLECTION_API_USER')}:${Cypress.env('MTN_COLLECTION_API_KEY')}`
//               ),
//           },
//         }).then((response) => {
//           expect(response.status).to.eq(200);
//           accessToken = response.body.access_token;
//           cy.task('log', accessToken);
//           Cypress.env('accessToken', accessToken);
//         });
//       });
//
//       it('Checks Transaction Status', () => {
//         cy.request({
//           method: 'GET',
//           url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${Cypress.env('transactionId')}`,
//           headers: {
//             'X-Target-Environment': 'sandbox',
//             Authorization: `Bearer ${Cypress.env('accessToken')}`,
//             'Ocp-Apim-Subscription-Key': `${Cypress.env('MTN_COLLECTION_SUBSCRIPTION_KEY')}`,
//           },
//         }).then((response) => {
//           expect(response.status).to.eq(200);
//           cy.task('log', response.body);
//           expect(response.body).to.have.property(
//             'payerMessage',
//             'PayQAM payment request'
//           );
//           expect(response.body).to.have.property('status', 'SUCCESSFUL');
//           externalId = response.body.externalId;
//           cy.task('log', externalId);
//           Cypress.env('externalId', externalId);
//         });
//       });
//     });
//   });
// });

