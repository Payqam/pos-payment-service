//Will Complete additional enhancements and error handling once production access is available.
import testData from '../../cypress/fixtures/orange_test_data.json';

let transactionId;

describe('Validate Refund Negative Scenario', () => {
  testData.RefundTestsData.forEach((test) => {
    describe(`Verify error for refunding an already ${test.title}`, () => {
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
          } else {
            if (attempt < 7) {
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

      it(`Process Payment Refund with amount of ${test.amount}`, () => {
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
          cy.wait(5000);
        });
      });

      it(`Process Payment Refund again to already refunded with amount of ${test.amount}`, () => {
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
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.transactionDetails).to.have.property(
            'message',
            'Transaction has already been fully refunded'
          );
          expect(response.body.transactionDetails).to.have.property(
            'status',
            'ALREADY_REFUNDED'
          );
          transactionId = response.body.transactionDetails.transactionId;
          Cypress.env('transactionId', transactionId);
          cy.wait(5000);
        });
      });
    });
  });

  describe(`Verify error for refunding failure for an invalid transaction ID`, () => {
    it(`Process Payment Refund with Invalid transaction Id`, () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/refund`,
        body: {
          transactionId: `6ac14fc8-7ac3-4815-bd67-eb62533c4H70`,
          merchantId: 'M123',
          amount: 3000,
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
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.transactionDetails).to.have.property(
          'message',
          'Transaction not found with ID: 6ac14fc8-7ac3-4815-bd67-eb62533c4H70'
        );
        expect(response.body.transactionDetails).to.have.property(
          'status',
          'FAILED'
        );
        cy.wait(5000);
      });
    });
  });

  testData.RefundsTestData.forEach((test) => {
    describe(`Verify error for refunding an already ${test.title}`, () => {
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
          } else {
            if (attempt < 7) {
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
        cy.wait(5000);
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

      it(`Process Payment Refund 01 with amount of ${test.amount}`, () => {
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

      it(`Process Payment Refund 02 with amount of 2000`, () => {
        cy.wait(4000);
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/refund`,
          body: {
            transactionId: `${Cypress.env('transactionId')}`,
            merchantId: 'M123',
            amount: 2000,
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

      it(`Process Payment Refund again to already refunded with amount of ${test.amount}`, () => {
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
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.transactionDetails).to.have.property(
            'message',
            'Transaction has already been fully refunded'
          );
          expect(response.body.transactionDetails).to.have.property(
            'status',
            'ALREADY_REFUNDED'
          );
          transactionId = response.body.transactionDetails.transactionId;
          Cypress.env('transactionId', transactionId);
          cy.wait(5000);
        });
      });
    });
  });

  describe(`Verify Amount Greater Than Original Payment refund behavior`, () => {
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
          expect(transaction.amount).to.eq(2000);
          cy.task(
            'log',
            `${JSON.stringify(response.body.transaction.Item.status)}`
          );
        } else {
          if (attempt < 7) {
            cy.task('log', `Retrying charge process, attempt: ${attempt + 1}`);
            cy.wait(1000);
            checkTransactionStatus(attempt + 1);
          } else {
            cy.task('log', 'Max retry attempts reached. Transaction failed.');
          }
        }
      });
    }

    it('Process a payment for refund with the amount of 2000', () => {
      cy.wait(4000);
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        body: {
          merchantId: 'M123',
          amount: 2000,
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

    it(`Process Payment Refund with amount of 3000`, () => {
      cy.wait(3500);
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/refund`,
        body: {
          transactionId: `${Cypress.env('transactionId')}`,
          merchantId: 'M123',
          amount: 3000,
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
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.transactionDetails).to.have.property(
          'message',
          'Refund amount (3000) cannot exceed original payment amount (2000)'
        );
        expect(response.body.transactionDetails).to.have.property(
          'status',
          'FAILED'
        );
        cy.wait(500);
      });
    });
  });
});

describe('Orange Payment Processing Tests - Negative Scenarios', () => {
  describe('Verify payment request with Invalid details', () => {
    it('should return 400 Bad Request when payer details are missing', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        body: {
          merchantId: '691654524',
          amount: 120000,
          transactionType: 'CHARGE',
          paymentMethod: 'ORANGE',
          customerPhone: '699944974',
          currency: 'EUR',
          cardData: {},
          metaData: {
            deviceId: 'deviceID',
            location: 'transaction_location',
            timestamp: 'transaction_timestamp',
          },
          merchantMobileNo: '691654524',
        },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('InvalidApiKey')}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
        expect(response.body).to.have.property('message');
        expect(response.body.message).to.include('Forbidden');
      });
    });

    it('should return 400 Bad Request with empty request body', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
        body: {},
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${Cypress.env('orangeApiKey')}`,
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.message).to.include('Invalid request body');
      });
    });
  });

  describe('Verify request without x-api-key', () => {
    describe('Verify transaction status request without x-api-key', () => {
      it('should process a payment charge', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          body: {
            merchantId: '691654524',
            amount: 120000,
            transactionType: 'CHARGE',
            paymentMethod: 'ORANGE',
            customerPhone: '699944974',
            currency: 'EUR',
            cardData: {},
            metaData: {
              deviceId: 'deviceID',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
            merchantMobileNo: '691654524',
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

      it('`should return 403 Bad Request', () => {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/status/?transactionId=${Cypress.env('transactionId')}`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': '',
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(403);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include('Forbidden');
        });
      });
    });

    describe('Verify payment process request without x-api-key', () => {
      it('should return 400 Bad Request when api key is missing', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          body: {
            merchantId: '691654524',
            amount: 120000,
            transactionType: 'CHARGE',
            paymentMethod: 'ORANGE',
            customerPhone: '699944974',
            currency: 'EUR',
            cardData: {},
            metaData: {
              deviceId: 'deviceID',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
            merchantMobileNo: '691654524',
          },
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ' ',
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(403);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include('Forbidden');
        });
      });
    });
  });

  describe('Verify payment request with Invalid and Empty Data', () => {
    testData.invalidData.forEach((test) => {
      it(`should return ${test.expectedStatus} Bad Request when using ${test.title}`, () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('orangePaymentServiceEndpoint')}/transaction/process/charge`,
          body: {
            merchantId: test.body['orange[merchantId]'] || '691654524',
            amount: test.body['orange[amount]'] || '12000',
            transactionType: 'CHARGE',
            paymentMethod: 'ORANGE',
            customerPhone: test.body['orange[customerPhone]'] || '94767987987',
            currency: test.body['orange[currency]'] || 'EUR',
            cardData: {},
            metaData: {
              deviceId: 'deviceID',
              location: 'transaction_location',
              timestamp: 'transaction_timestamp',
            },
            merchantMobileNo:
              test.body['orange[merchantMobileNo]'] || '94767987987',
          },
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${Cypress.env('orangeApiKey')}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(test.expectedStatus);
          expect(response.body).to.have.property('message');
          expect(response.body.message).to.include(test.expectedMessage);
        });
      });
    });
  });
});
