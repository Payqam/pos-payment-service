import testData from '../../cypress/fixtures/mtn_test_data.json';

describe('MTN Payment Processing Tests - Negative Scenarios', () => {
  describe('Verify payment request with Invalid details', () => {
    it('should return 400 Bad Request when payer details are missing', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('ServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('InvalidxApiKey')}`,
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
  });

  describe('Verify payment request with an Invalid Amount', () => {
    it('should return 400 Bad Request when using an unsupported currency', () => {
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
          amount: 'ABC',
          customerPhone: '94713579023',
          transactionType: 'PAYMENT',
          paymentMethod: 'MTN',
          currency: 'ABC',
          metaData: {
            reference: 'ORDER_123',
            description: 'Payment for order #123',
          },
        },
      }).then((response) => {
        expect(response.status).to.eq(400);
        cy.task('log', response.body);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Invalid request body');
      });
    });
  });
});

describe('MTN Payment Processing Tests - Negative Scenarios', () => {
  const serviceEndpoint = Cypress.env('ServiceEndpoint');
  const xApiKey = Cypress.env('xApiKey');

  testData.invalidData.forEach((test) => {
    it(`Verify ${test.expectedStatus} response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: `${serviceEndpoint}/transaction/process/charge`,
        headers: {
          'x-api-key': xApiKey,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          'mtn[merchantId]': test.body['mtn[merchantId]'] || 'MERCHANT_123',
          'mtn[merchantMobileNo]':
            test.body['mtn[merchantMobileNo]'] || '94760000000',
          'mtn[customerPhone]':
            test.body['mtn[customerPhone]'] || '94710000000',
          'mtn[amount]': test.body['mtn[amount]'] || 100,
          'mtn[transactionType]':
            test.body['mtn[transactionType]'] || 'PAYMENT',
          paymentMethod: 'MTN',
        },
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.status).to.not.eq(200);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Invalid request body');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});

describe('MTN Request to Pay Payer Tests - Negative Scenarios', () => {
  const serviceEndpoint = Cypress.env('ServiceEndpoint');
  const xApiKey = Cypress.env('xApiKey');

  testData.requestToPayPayer.forEach((test) => {
    it(`Verify 400 response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: `${serviceEndpoint}/transaction/process/charge`,
        headers: {
          'x-api-key': xApiKey,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          'mtn[merchantId]': 'MERCHANT_123',
          'mtn[merchantMobileNo]': '94760000000',
          'mtn[customerPhone]': test.payer,
          'mtn[amount]': 100,
          'mtn[transactionType]': 'PAYMENT',
          paymentMethod: 'MTN',
        },
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.status).to.not.eq(200);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Invalid request body');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});

describe('MTN PreApproval Tests - Negative Scenarios', () => {
  const serviceEndpoint = Cypress.env('ServiceEndpoint');
  const xApiKey = Cypress.env('xApiKey');

  testData.preApproval.forEach((test) => {
    it(`Verify 400 response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: `${serviceEndpoint}/transaction/process/charge`,
        headers: {
          'x-api-key': xApiKey,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          'mtn[merchantId]': 'MERCHANT_123',
          'mtn[merchantMobileNo]': '94760000000',
          'mtn[customerPhone]': test.payer,
          'mtn[amount]': 100,
          'mtn[transactionType]': 'PAYMENT',
          paymentMethod: 'MTN',
        },
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.status).to.not.eq(200);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Invalid request body');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});

describe('MTN Request to Pay Payer Tests - Negative Scenarios', () => {
  const serviceEndpoint = Cypress.env('ServiceEndpoint');
  const xApiKey = Cypress.env('xApiKey');

  testData.transferPayee.forEach((test) => {
    it(`Verify 400 response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: `${serviceEndpoint}/transaction/process/charge`,
        headers: {
          'x-api-key': xApiKey,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          'mtn[merchantId]': 'MERCHANT_123',
          'mtn[merchantMobileNo]': test.merchant,
          'mtn[customerPhone]': '94760000000',
          'mtn[amount]': 100,
          'mtn[transactionType]': 'PAYMENT',
          paymentMethod: 'MTN',
        },
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.status).to.not.eq(200);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Invalid request body');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});
let accessToken;
describe('MTN Account Holder Active Party Code Tests - Negative Scenarios', () => {
  testData.AccountHolderActivePartyCode.forEach((test) => {
    describe(`Account Holder Active Party Code Tests for ${test.title}`, () => {
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
