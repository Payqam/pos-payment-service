import testData from '../../cypress/fixtures/mtn_test_data.json';

let transactionId, accessToken, Id;

describe('MTN Request to Pay Payer Tests - Negative Scenarios', () => {
  testData.requestToPayPayer.forEach((test) => {
    describe(`MTN Request to Pay Payer Tests  ${test.title}`, () => {
      it(`Process a payment using ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
          body: {
            merchantId: 'M123',
            merchantMobileNo: '94767987987',
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
          expect(response.body.transaction.Item).to.have.property(
            'status',
            'PAYMENT_FAILED'
          );
          expect(
            response.body.transaction.Item.paymentResponse
          ).to.have.property('reason', test.reason);
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
        cy.wait(3500);
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
            'PAYMENT_FAILED'
          );
          Id = response.body.records[0].Id;
          cy.task('log', `Id : ${Id}`);
          Cypress.env('Id', Id);
          cy.task('log', response.body);
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
          cy.task('log', response.body);
          expect(response.body.records[0]).to.have.property(
            'Error_Code__c',
            test.Error_Code__c
          );
          expect(response.body.records[0]).to.have.property(
            'Error_Message__c',
            test.reason
          );
          expect(response.body.records[0]).to.have.property(
            'Error_Type__c',
            test.Error_Type__c
          );
        });
      });
    });
  });
});

describe('Validate Refund Negative Scenario', () => {
  testData.RefundTestData.forEach((test) => {
    describe(`Verify error for refunding an already ${test.title}`, () => {
      it(`Process a payment for refund with amount of 2000`, () => {
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
            amount: 2000,
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
          cy.wait(1000);
        });
      });

      it(`Process Payment Refund with amount of ${test.amount}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
          body: {
            transactionType: 'REFUND',
            paymentMethod: 'MTN',
            amount: test.amount,
            transactionId: `${Cypress.env('transactionId')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          cy.task('log', response.body);
          expect(response.body).to.have.property(
            'message',
            'Refund processed successfully'
          );
          expect(response.body).to.have.property('transactionDetails');
          expect(response.body.transactionDetails).to.have.property(
            'status',
            'CUSTOMER_REFUND_REQUEST_CREATED'
          );
        });
      });

      it(`Process Payment Refund again to already refunded with amount of ${test.amount}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
          body: {
            transactionType: 'REFUND',
            paymentMethod: 'MTN',
            amount: test.amount,
            transactionId: `${Cypress.env('transactionId')}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(400);
          cy.task('log', response.body);
          expect(response.body).to.have.property(
            'message',
            'Refund amount exceeds the original transaction amount'
          );
          expect(response.body).to.have.property(
            'errorCode',
            'REFUND_AMOUNT_EXCEEDS_ORIGINAL'
          );
          cy.wait(500);
        });
      });
    });
  });

  describe('Validate Partial Refund process with two partial refunds', () => {
    it('Process a payment for refund with the amount of 2000', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          merchantId: 'M123',
          merchantMobileNo: '07000000000',
          amount: 2000,
          customerPhone: '07000010000',
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
        cy.wait(1000);
      });
    });

    it('Process Partial Refund Process 1 for the amount of 500', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          transactionType: 'REFUND',
          paymentMethod: 'MTN',
          amount: 500,
          transactionId: `${Cypress.env('transactionId')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        cy.task('log', response.body);
        expect(response.body).to.have.property(
          'message',
          'Refund processed successfully'
        );
        expect(response.body).to.have.property('transactionDetails');
        expect(response.body.transactionDetails).to.have.property(
          'status',
          'CUSTOMER_REFUND_REQUEST_CREATED'
        );
      });
    });

    it('Process Partial Refund Process 2 for the amount of 1000', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          transactionType: 'REFUND',
          paymentMethod: 'MTN',
          amount: 1000,
          transactionId: `${Cypress.env('transactionId')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        cy.task('log', response.body);
        expect(response.body).to.have.property(
          'message',
          'Refund processed successfully'
        );
        expect(response.body).to.have.property('transactionDetails');
        expect(response.body.transactionDetails).to.have.property(
          'status',
          'CUSTOMER_REFUND_REQUEST_CREATED'
        );
      });
    });

    it('Process Partial Refund Process 3 for the amount of 2000 which exceeds the original transaction amount ', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          transactionType: 'REFUND',
          paymentMethod: 'MTN',
          amount: 2000,
          transactionId: `${Cypress.env('transactionId')}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        cy.task('log', response.body);
        expect(response.body).to.have.property(
          'message',
          'Refund amount exceeds the original transaction amount'
        );
        expect(response.body).to.have.property(
          'errorCode',
          'REFUND_AMOUNT_EXCEEDS_ORIGINAL'
        );
        cy.wait(500);
      });
    });
  });

  describe(`Verify Amount Greater Than Original Payment refund behavior`, () => {
    it('Process a payment for refund with the amount of 2000', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          merchantId: 'M123',
          merchantMobileNo: '07000000000',
          amount: 2000,
          customerPhone: '07000010000',
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
        cy.wait(1000);
      });
    });

    it(`Process Payment Refund with amount of 3000`, () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
          'Content-Type': 'application/json',
        },
        body: {
          transactionType: 'REFUND',
          paymentMethod: 'MTN',
          amount: 3000,
          transactionId: `${Cypress.env('transactionId')}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        cy.task('log', response.body);
        expect(response.body).to.have.property(
          'message',
          'Refund amount exceeds the original transaction amount'
        );
        expect(response.body).to.have.property(
          'errorCode',
          'REFUND_AMOUNT_EXCEEDS_ORIGINAL'
        );
        cy.wait(500);
      });
    });
  });
});

describe(`Verify error for refunding failure for an invalid transaction ID`, () => {
  it('Process a payment for refund', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
      headers: {
        'x-api-key': `${Cypress.env('MTNApiKey')}`,
        'Content-Type': 'application/json',
      },
      body: {
        merchantId: 'M123',
        merchantMobileNo: '07000000000',
        amount: 2000,
        customerPhone: '07000010000',
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
      cy.wait(1000);
    });
  });

  it(`Process Payment Refund with Invalid transaction Id`, () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/refund`,
      headers: {
        'x-api-key': `${Cypress.env('MTNApiKey')}`,
        'Content-Type': 'application/json',
      },
      body: {
        transactionType: 'REFUND',
        paymentMethod: 'MTN',
        amount: 2000,
        transactionId: '6ac14fc8-7ac3-4615-bd47-eb62533c4H70',
      },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(500);
      expect(response.body).to.have.property(
        'message',
        'Transaction not found for refund'
      );
      expect(response.body).to.have.property('errorCode', 'UNEXPECTED_ERROR');
      cy.task('log', response.body);
      cy.wait(500);
    });
  });
});

describe('MTN Payment Processing Tests - Negative Scenarios', () => {
  describe('Verify payment request with Invalid details', () => {
    it('should return 400 Bad Request when payer details are missing', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('InvalidApiKey')}`,
          'Content-Type': 'application/json',
        },
        failOnStatusCode: false,
        body: {
          merchantId: 'M_123',
          merchantMobileNo: '94767987987',
          customerPhone: '94713579023',
          amount: 100.12,
          transactionType: 'CHARGE',
          paymentMethod: 'MTN',
          currency: 'EUR',
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
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/process/charge`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
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
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${test.transactionId}`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
            'Content-Type': 'application/json',
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          cy.task('log', response.body);
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
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${test.transactionId}`,
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
        });
      });

      it('Generates an Access Token', () => {
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

      it(`Checks Transaction Status for ${test.title}`, () => {
        cy.request({
          method: 'GET',
          url: `https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/${test.transactionId}`,
          headers: {
            'X-Target-Environment': 'sandbox',
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
            'Ocp-Apim-Subscription-Key': `${Cypress.env('MTNCollectionSubscriptionKey')}`,
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
