import testData from '../../cypress/fixtures/orange_test_data.json';

let transactionId, accessToken, txnmode, txnmode1;
describe('Orange Money Automation', () => {
  it('should process a payment charge', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
      body: {
        merchantId: 'M123',
        amount: 12000,
        transactionType: 'CHARGE',
        paymentMethod: 'ORANGE',
        customerPhone: '691654524',
        currency: '',
        cardData: {},
        metaData: {
          deviceId: 'deviceID',
          location: 'transaction_location',
          timestamp: 'transaction_timestamp',
        },
        merchantMobileNo: '691654529',
      },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('orangeApiKey')}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      transactionId = response.body.transactionDetails.transactionId;
      Cypress.env('transactionId', transactionId);
      cy.wait(500);
    });
  });

  const checkTransactionStatus = (attempt = 1) => {
    const maxAttempts = 5;
    const delay = Math.pow(2, attempt) * 1000;

    cy.request({
      method: 'GET',
      url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${Cypress.env('orangeApiKey')}`,
      },
      failOnStatusCode: false,
    }).then((response) => {
      cy.task(
        'log',
        `Attempt ${attempt}: ${JSON.stringify(response.body.transaction.Item.status)}`
      );

      if (
        response.status === 200 &&
        response.body.transaction?.Item?.status === 'PAYMENT_SUCCESSFUL'
      ) {
        expect(response.body.transaction.Item).to.have.property(
          'status',
          'PAYMENT_SUCCESSFUL'
        );
        expect(response.body.transaction.Item).to.have.property(
          'settlementStatus',
          'DISBURSEMENT_SUCCESSFUL'
        );
        cy.task(
          'log',
          `Transaction successful: ${JSON.stringify(response.body.transaction.Item.status)}`
        );
      } else if (attempt < maxAttempts) {
        cy.wait(delay).then(() => checkTransactionStatus(attempt + 1));
      } else {
        throw new Error(
          'Transaction status did not reach expected state after maximum retries.'
        );
      }
    });
  };

  it('should check transaction status', () => {
    checkTransactionStatus();
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
        accessToken = response.body.access_token;
        Cypress.env('accessToken', accessToken);
        cy.wait(500);
      });
    });

    it(`Verify Payment on salesforce`, () => {
      cy.wait(3000);
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
          'PAYMENT_SUCCESSFUL'
        );
        expect(response.body.records[0]).to.have.property('Fee__c', '240');
        expect(response.body.records[0]).to.have.property('amount__c', '11760');
        expect(response.body.records[0]).to.have.property(
          'Net_Amount__c',
          '12000'
        );
        expect(response.body.records[0]).to.have.property(
          'MerchantId__c',
          'M123'
        );
        expect(response.body.records[0]).to.have.property(
          'Merchant_Phone__c',
          '691654529'
        );
        expect(response.body.records[0]).to.have.property(
          'Customer_Phone__c',
          '691654524'
        );
        expect(response.body.records[0]).to.have.property(
          'ServiceType__c',
          'Orange'
        );
        expect(response.body.records[0]).to.have.property('currency__c', 'EUR');
        cy.wait(1000);
      });
    });
  });
});

testData.RefundTestData.forEach((test) => {
  describe('Validate Refund Scenario', () => {
    describe(`Verify successful refund  ${test.title}`, () => {
      function checkTransactionStatus(attempt = 1) {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('orangeApiKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);

          const transaction = response.body?.transaction?.Item;

          if (
            transaction &&
            transaction.status === 'PAYMENT_SUCCESSFUL' &&
            transaction.settlementStatus === 'DISBURSEMENT_SUCCESSFUL'
          ) {
            expect(transaction.amount).to.eq(12000);
            cy.task(
              'log',
              `${JSON.stringify(response.body.transaction.Item.status)}`
            );
            cy.task('log', response.body);
          } else {
            if (attempt < 6) {
              cy.task(
                'log',
                `Retrying charge process, attempt: ${attempt + 1}`
              );
              cy.wait(1000);
              checkTransactionStatus(attempt + 1);
            } else {
              cy.task('log', 'Max retry attempts reached. Transaction failed.');
            }
          }
        });
      }

      it('should process a payment charge', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          body: {
            merchantId: 'M123',
            amount: 12000,
            transactionType: 'CHARGE',
            paymentMethod: 'ORANGE',
            customerPhone: '691654524',
            currency: '',
            cardData: {},
            metaData: {
              deviceId: 'deviceID',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
            merchantMobileNo: '691654529',
          },
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('orangeApiKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);

          transactionId = response.body?.transactionDetails?.transactionId;
          if (transactionId) {
            cy.task('log', `Transaction ID : ${transactionId}`);
            Cypress.env('transactionId', transactionId);
            cy.wait(500);
            checkTransactionStatus();
          } else {
            cy.task('log', 'Transaction ID not found in response');
            throw new Error('Transaction ID not found');
          }
        });
      });

      it(`Process Payment Refund with the amount of ${test.amount}`, () => {
        cy.wait(5000);
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/refund`,
          body: {
            transactionId: `${Cypress.env('transactionId')}`,
            merchantId: 'M123',
            amount: test.amount,
            transactionType: 'REFUND',
            paymentMethod: 'ORANGE',
            customerPhone: '691654524',
            currency: 'EUR',
            cardData: {},
            metaData: {
              deviceId: 'deviceID',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
            merchantMobileNo: '691654529',
          },
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('orangeApiKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          transactionId = response.body.transactionDetails.transactionId;
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
        });
      });

      it('Verify Original Transaction Refund Status', () => {
        cy.wait(3500);
        cy.request({
          method: 'GET',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('orangeApiKey')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.transaction.Item).to.have.property('status');
          expect(response.body.transaction.Item).to.have.property(
            'status',
            'MERCHANT_REFUND_SUCCESSFUL'
          );
          expect(
            response.body.transaction.Item.refundMpResponse
          ).to.have.property('amount', test.amount);
          txnmode = response.body.transaction.Item.refundMpResponse.txnmode;
          Cypress.env('txnmode', txnmode);
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
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'MERCHANT_REFUND_REQUEST_CREATED'
          );
          expect(response.body.records[0]).to.have.property(
            'MerchantId__c',
            'M123'
          );
        });
      });

      it(`Verify Refund on salesforce`, () => {
        cy.wait(3500);
        cy.request({
          method: 'GET',
          url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Net_Amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('txnmode')}'`,
          headers: {
            Authorization: `Bearer ${Cypress.env('accessToken')}`,
          },
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.records[0]).to.have.property(
            'status__c',
            'MERCHANT_REFUND_REQUEST_CREATED'
          );
          expect(response.body.records[0]).to.have.property(
            'Net_Amount__c',
            String(test.amount)
          );
        });
      });
    });
  });
});

describe('Validate Partial Refund - Edge Case', () => {
  describe('Validate Partial Refund process with two partial refunds', () => {
    function checkTransactionStatus(attempt = 1) {
      cy.request({
        method: 'GET',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);

        const transaction = response.body?.transaction?.Item;

        if (
          transaction &&
          transaction.status === 'PAYMENT_SUCCESSFUL' &&
          transaction.settlementStatus === 'DISBURSEMENT_SUCCESSFUL'
        ) {
          expect(transaction.amount).to.eq(12000);
          cy.task(
            'log',
            `${JSON.stringify(response.body.transaction.Item.status)}`
          );
        } else {
          if (attempt < 6) {
            cy.task('log', `Retrying charge process, attempt: ${attempt + 1}`);
            cy.wait(1000);
            checkTransactionStatus(attempt + 1);
          } else {
            cy.task('log', 'Max retry attempts reached. Transaction failed.');
          }
        }
      });
    }

    it('should process a payment charge', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        body: {
          merchantId: 'M123',
          amount: 12000,
          transactionType: 'CHARGE',
          paymentMethod: 'ORANGE',
          customerPhone: '691654524',
          currency: '',
          cardData: {},
          metaData: {
            deviceId: 'deviceID',
            location: 'transaction_location',
            timestamp: 'transaction_timestamp',
          },
          merchantMobileNo: '691654529',
        },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        transactionId = response.body?.transactionDetails?.transactionId;
        if (transactionId) {
          Cypress.env('transactionId', transactionId);
          cy.wait(500);
          checkTransactionStatus();
        } else {
          cy.task('log', 'Transaction ID not found in response');
          throw new Error('Transaction ID not found');
        }
      });
    });

    it(`Process Partial Refund 01 with the amount of 500`, () => {
      cy.wait(5000);
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/refund`,
        body: {
          transactionId: `${Cypress.env('transactionId')}`,
          merchantId: 'M123',
          amount: 500,
          transactionType: 'REFUND',
          paymentMethod: 'ORANGE',
          customerPhone: '691654524',
          currency: 'EUR',
          cardData: {},
          metaData: {
            deviceId: 'deviceID',
            location: 'transaction_location',
            timestamp: 'transaction_timestamp',
          },
          merchantMobileNo: '691654529',
        },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        transactionId = response.body.transactionDetails.transactionId;
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it('Verify Original Transaction Refund Status of Partial Refund 01', () => {
      cy.wait(3500);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.transaction.Item).to.have.property('status');
        expect(response.body.transaction.Item).to.have.property(
          'status',
          'MERCHANT_REFUND_SUCCESSFUL'
        );
        expect(
          response.body.transaction.Item.refundMpResponse
        ).to.have.property('amount', 500);
        txnmode = response.body.transaction.Item.refundMpResponse.txnmode;
        Cypress.env('txnmode', txnmode);
      });
    });

    it(`Process Partial Refund 02 with the amount of 500`, () => {
      cy.wait(3000);
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/refund`,
        body: {
          transactionId: `${Cypress.env('transactionId')}`,
          merchantId: 'M123',
          amount: 500,
          transactionType: 'REFUND',
          paymentMethod: 'ORANGE',
          customerPhone: '691654524',
          currency: 'EUR',
          cardData: {},
          metaData: {
            deviceId: 'deviceID',
            location: 'transaction_location',
            timestamp: 'transaction_timestamp',
          },
          merchantMobileNo: '691654529',
        },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        transactionId = response.body.transactionDetails.transactionId;
        Cypress.env('transactionId', transactionId);
        cy.wait(500);
      });
    });

    it('Verify Original Transaction Refund Status of Partial Refund 02', () => {
      cy.wait(3500);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.transaction.Item).to.have.property('status');
        expect(response.body.transaction.Item).to.have.property(
          'status',
          'MERCHANT_REFUND_SUCCESSFUL'
        );
        expect(
          response.body.transaction.Item.refundMpResponse
        ).to.have.property('amount', 500);
        txnmode1 = response.body.transaction.Item.refundMpResponse.txnmode;
        Cypress.env('txnmode1', txnmode1);
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
        url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('transactionId')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'MERCHANT_REFUND_REQUEST_CREATED'
        );
        expect(response.body.records[0]).to.have.property(
          'MerchantId__c',
          'M123'
        );
      });
    });

    it(`Verify Refund 01 on salesforce`, () => {
      cy.wait(3500);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Net_Amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('txnmode')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'MERCHANT_REFUND_REQUEST_CREATED'
        );
        expect(response.body.records[0]).to.have.property(
          'Net_Amount__c',
          '500'
        );
      });
    });

    it(`Verify Refund 02 on salesforce`, () => {
      cy.wait(3500);
      cy.request({
        method: 'GET',
        url: `${Cypress.env('salesforceServiceUrl')}status__c,amount__c,Net_Amount__c,Fee__c,Currency__c,MerchantId__c,Name+FROM+Transaction__c+WHERE+transactionId__c='${Cypress.env('txnmode1')}'`,
        headers: {
          Authorization: `Bearer ${Cypress.env('accessToken')}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.records[0]).to.have.property(
          'status__c',
          'MERCHANT_REFUND_REQUEST_CREATED'
        );
        expect(response.body.records[0]).to.have.property(
          'Net_Amount__c',
          '500'
        );
      });
    });
  });
});
