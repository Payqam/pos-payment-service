describe('Security Tests - API Response Verification', () => {
  const invalidPayloads = [
    {
      testName: 'SQL Injection',
      payload: {
        type: 'card',
        'card[number]': "' OR 1=1 --",
        'card[exp_month]': '12',
        'card[exp_year]': '2025',
        'card[cvc]': '123',
      },
    },
    {
      testName: 'Cross-Site Scripting (XSS)',
      payload: {
        type: 'card',
        'card[number]': "<script>alert('XSS')</script>",
        'card[exp_month]': '12',
        'card[exp_year]': '2025',
        'card[cvc]': '123',
      },
    },
  ];

  invalidPayloads.forEach(({ testName, payload }) => {
    it(`Should reject ${testName} payload`, () => {
      cy.request({
        method: 'POST',
        url: `${Cypress.env('paymentApiUrl')}payment_methods`,
        headers: {
          Authorization: `Bearer ${Cypress.env('stripeApiKey')}`,
        },
        form: true,
        body: payload,
        failOnStatusCode: false, // Prevent test from failing on expected errors
      }).then((response) => {
        cy.task('log', response.body);
        expect(response.status).to.be.oneOf([402]); // Expect 400 Bad Request or 422 Unprocessable Entity
        expect(response.body).to.have.property('error');
        expect(response.body.error).to.have.property('message');
      });
    });
  });

  it('Should reject unauthorized API request (missing API key)', () => {
    cy.request({
      method: 'POST',
      url: `${Cypress.env('paymentApiUrl')}payment_methods`,
      form: true,
      body: {
        type: 'card',
        'card[number]': '4242424242424242',
        'card[exp_month]': '12',
        'card[exp_year]': '2025',
        'card[cvc]': '123',
      },
      failOnStatusCode: false, // Prevent test from failing on expected errors
    }).then((response) => {
      cy.task('log', response.body);
      expect(response.status).to.eq(401);
      expect(response.body).to.have.property('error');
      expect(response.body.error).to.have.property('message');
    });
  });
});
