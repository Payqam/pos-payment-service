import testData from '../../cypress/fixtures/mtn_test_data.json';

let transactionId,
  uniqueId,
  accessToken,
  externalId2,
  externalId1,
  MerchantExternalId1;

describe('MTN Payment Processing Tests', () => {
  testData.requestPayer.forEach((test) => {
    describe(`Validate ${test.title} Payment Processing`, () => {
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
            'PAYMENT_REQUEST_CREATED'
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

      it('Checks Transaction Status', () => {
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
          expect(response.body).to.have.property('status', 'PENDING');
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
          url: `${Cypress.env('salesforceServiceUrl')}status__c,Net_Amount__c,ServiceType__c,Merchant_Phone__c,Customer_Phone__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'PAYMENT_REQUEST_CREATED'
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

describe('Validate Refund Scenario', () => {
  testData.RefundTestData.forEach((test) => {
    describe(`Verify successful refund  ${test.title}`, () => {
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

      it('Process Payment Refund', () => {
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

      it('Verify Original Transaction Refund Status', () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'x-api-key': `${Cypress.env('MTNApiKey')}`,
          },
        }).then((response) => {
          expect(response.body.transaction.Item).to.have.property(
            'customerRefundResponse'
          );
          expect(response.body.transaction.Item.customerRefundResponse)
            .to.be.an('array')
            .and.have.length(1);
          expect(response.body.transaction.Item.status).to.eq(
            'MERCHANT_REFUND_SUCCESSFUL'
          );
          expect(
            response.body.transaction.Item.customerRefundResponse[0]
          ).to.deep.include({
            amount: String(test.amount),
            currency: 'EUR',
            status: 'SUCCESSFUL',
          });
          externalId1 =
            response.body.transaction.Item.customerRefundResponse[0].externalId;
          cy.task('log', `External ID 1: ${externalId1}`);
          Cypress.env('externalId1', externalId1);

          expect(response.body.transaction.Item.merchantRefundResponse)
            .to.be.an('array')
            .and.have.length(1);
          expect(response.body.transaction.Item.status).to.eq(
            'MERCHANT_REFUND_SUCCESSFUL'
          );
          expect(
            response.body.transaction.Item.merchantRefundResponse[0]
          ).to.deep.include({
            currency: 'EUR',
            status: 'SUCCESSFUL',
          });
          expect(
            Number(
              response.body.transaction.Item.merchantRefundResponse[0].amount
            )
          ).to.equal(test.amount);
          MerchantExternalId1 =
            response.body.transaction.Item.merchantRefundResponse[0].externalId;
          cy.task('log', `MerchantExternal ID 1: ${MerchantExternalId1}`);
          Cypress.env('MerchantExternalId1', MerchantExternalId1);
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
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'MERCHANT_REFUND_SUCCESSFUL'
          );
          expect(response.body.records[0]).to.have.property(
            'MerchantId__c',
            'M123'
          );
          cy.task('log', response.body);
        });
      });

      it(`Verify Refund on salesforce`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Net_Amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('externalId1')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'CUSTOMER_REFUND_SUCCESSFUL'
          );
          expect(response.body.records[0]).to.have.property(
            'Net_Amount__c',
            String(test.amount)
          );
          cy.task('log', response.body);
        });
      });

      it(`Verify Refund on salesforce by merchantExternalId`, () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Net_Amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('MerchantExternalId1')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'MERCHANT_REFUND_SUCCESSFUL'
          );
          expect(response.body.records[0]).to.have.property(
            'Net_Amount__c',
            String(test.amount)
          );
          cy.task('log', response.body);
        });
      });
    });
  });

  describe('Validate Partial Refund process with two partial refunds', () => {
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

    it('Process Partial Refund Process 1', () => {
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

    it('Verify Original Transaction Refund Status', () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
        },
      }).then((response) => {
        expect(
          Number(
            response.body.transaction.Item.merchantRefundResponse[0].amount
          )
        ).to.equal(500);
        expect(response.body.transaction.Item.status).to.eq(
          'MERCHANT_REFUND_SUCCESSFUL'
        );
        cy.task('log', response.body);
      });
    });

    it('Process Partial Refund Process 2', () => {
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

    it('Verify Original Transaction Refund Status', () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('MTNServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
        headers: {
          'x-api-key': `${Cypress.env('MTNApiKey')}`,
        },
      }).then((response) => {
        expect(response.body.transaction.Item).to.have.property(
          'customerRefundResponse'
        );
        expect(response.body.transaction.Item.customerRefundResponse)
          .to.be.an('array')
          .and.have.length(2);
        expect(response.body.transaction.Item.status).to.eq(
          'MERCHANT_REFUND_SUCCESSFUL'
        );
        expect(
          response.body.transaction.Item.customerRefundResponse[0]
        ).to.deep.include({
          amount: '500',
          currency: 'EUR',
          status: 'SUCCESSFUL',
        });
        externalId1 =
          response.body.transaction.Item.customerRefundResponse[0].externalId;
        cy.task('log', `External ID 1: ${externalId1}`);
        Cypress.env('externalId1', externalId1);

        expect(
          response.body.transaction.Item.customerRefundResponse[1]
        ).to.deep.include({
          amount: '500',
          currency: 'EUR',
          status: 'SUCCESSFUL',
        });
        externalId2 =
          response.body.transaction.Item.customerRefundResponse[1].externalId;
        cy.task('log', `External ID 2: ${externalId2}`);
        Cypress.env('externalId2', externalId2); // Store in Cypress.env
        cy.task('log', response.body);
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

    it('Checks Transaction Status from merchant to PayQam', () => {
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
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'MERCHANT_REFUND_SUCCESSFUL'
        );
        expect(response.body.records[0]).to.have.property(
          'MerchantId__c',
          'M123'
        );
        cy.task('log', response.body);
      });
    });

    it(`Verify Refund on salesforce`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Net_Amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('externalId1')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'CUSTOMER_REFUND_SUCCESSFUL'
        );
        expect(response.body.records[0]).to.have.property(
          'Net_Amount__c',
          '500'
        );
        cy.task('log', response.body);
      });
    });

    it(`Verify Refund2 on salesforce`, () => {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Net_Amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('externalId2')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'CUSTOMER_REFUND_SUCCESSFUL'
        );
        expect(response.body.records[0]).to.have.property(
          'Net_Amount__c',
          '500'
        );
        cy.task('log', response.body);
      });
    });
  });
});
