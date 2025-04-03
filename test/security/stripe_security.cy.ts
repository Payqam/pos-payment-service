describe('Security Tests - API Response Verification ', () => {
  let paymentMethodId, transactionId;
  describe(`API Key Validation for Payment Process`, () => {
    (
      Cypress.env('apiKeyValidation') as { title: string; apiKey: string }[]
    ).forEach((invalidApiKey) => {
      describe(`Payment Method API Key Validation with ${invalidApiKey.title}`, () => {
        it('Create a Payment Method', () => {
          cy.request({
            method: 'POST',
            url: `${Cypress.env('paymentApiUrl')}payment_methods`,
            headers: {
              Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
            },
            form: true,
            body: {
              type: 'card',
              'card[number]': '4242424242424242',
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

        it(`Verify 403 error for ${invalidApiKey.title}`, () => {
          cy.request({
            method: 'POST',
            url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': `${invalidApiKey.apiKey}`,
            },
            body: {
              merchantId: 'M123',
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
            failOnStatusCode: false,
          }).then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body).to.have.property('message', 'Forbidden');
          });
        });
      });
    });
  });
  (
    Cypress.env('apiKeyValidation') as { title: string; apiKey: string }[]
  ).forEach((invalidApiKey) => {
    describe(`Transaction Status API Key Validation with ${invalidApiKey.title}`, () => {
      it('Create a Payment Method', () => {
        cy.request({
          method: 'POST',
          url: `${Cypress.env('paymentApiUrl')}payment_methods`,
          headers: {
            Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
          },
          form: true,
          body: {
            type: 'card',
            'card[number]': '4242424242424242',
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
            'Payment processed successfully',
          );
          expect(response.body).to.have.property('transactionDetails');
          expect(response.body.transactionDetails).to.have.property(
            'transactionId',
          );
          expect(response.body.transactionDetails).to.have.property(
            'status',
            'succeeded',
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
            'x-api-key': `${invalidApiKey.apiKey}`,
          },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(403);
          expect(response.body).to.have.property('message', 'Forbidden');
        });
      });
    });
  });

  describe('Validate WAF - Block Malicious Payloads', () => {
    it('Create a Payment Method', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentApiUrl')}payment_methods`,
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
        },
        form: true,
        body: {
          type: 'card',
          'card[number]': '4242424242424242',
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

    it('Validate WAF - Block Malicious Payloads', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('x-api-key')}`,
          'Content-Type': 'application/json',
        },
        body: {
          merchantId: 'M123',
          amount: 1000,
          transactionType: '<script>alert("XSS")</script>',
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
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });

    it('Validate API XSS Protection', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('x-api-key')}`,
          'Content-Type': 'application/json',
        },
        body: {
          comment: '<script>alert("XSS")</script>',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });
  });

  describe('Validate SQL Injection Protection', () => {
    it('Create a Payment Method', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentApiUrl')}payment_methods`,
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
        },
        form: true,
        body: {
          type: 'card',
          'card[number]': '4242424242424242',
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

    it('Validate SQL Injection Protection', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('x-api-key')}`,
          'Content-Type': 'application/json',
        },
        body: {
          merchantId: 'M123',
          amount: 1000,
          transactionType: 'CHARGE',
          paymentMethod: 'CARD',
          customerPhone: '3333',
          currency: '\' OR \'1\'=\'1',
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
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });

    it('Validate Input Sanitization Against SQL Injection', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('x-api-key')}`,
          'Content-Type': 'application/json',
        },
        body: {
          query: '\' OR \'1\'=\'1',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(403);
      });
    });

    it('Validate Command Injection Vulnerability', () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentServiceEndpoint')}/transaction/process/charge`,
        headers: {
          'x-api-key': `${Cypress.env('x-api-key')}`,
          'Content-Type': 'application/json',
        },
        body: {
          command: 'rm -rf /',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });
});
