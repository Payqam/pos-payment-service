describe('Negative Payment Scenarios - Card Validation', () => {
  const paymentApiUrl = `${Cypress.env('paymentApiUrl')}payment_methods`;
  const stripeApiKey = Cypress.env('stripeApiKey');

  const invalidCardTests = [
    {
      title: 'Invalid card number',
      body: { 'card[number]': '1234567890123456' },
    },

    { title: 'Empty card number', body: { 'card[number]': ' ' } },
    { title: 'Short-length card number', body: { 'card[number]': '424242' } },
    {
      title: 'Extra-long card number',
      body: { 'card[number]': '42424242424242424242' },
    },
    {
      title: 'Alphanumeric card number',
      body: { 'card[number]': '4242abcd4242abcd' },
    },
    { title: 'Invalid expiry month', body: { 'card[exp_month]': '13' } },
    { title: 'Expiry year in the past', body: { 'card[exp_year]': '2020' } },
    {
      title: 'Just-expired card',
      body: { 'card[exp_month]': '10', 'card[exp_year]': '2023' },
    },
    { title: 'Maximum valid expiry year', body: { 'card[exp_year]': '2090' } },
    { title: 'Invalid CVC number', body: { 'card[cvc]': '12a' } },
    { title: 'CVC longer than allowed', body: { 'card[cvc]': '12345' } },
    { title: 'Empty CVC', body: { 'card[cvc]': ' ' } },
    {
      title: 'CVC with letters/special characters',
      body: { 'card[cvc]': '12$%' },
    },
  ];

  invalidCardTests.forEach((test) => {
    it(`Verify 402 response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: paymentApiUrl,
        headers: {
          Authorization: `Bearer ${stripeApiKey}`,
        },
        form: true,
        failOnStatusCode: false,
        body: {
          type: 'card',
          'card[number]': test.body['card[number]'] || '4242424242424242',
          'card[exp_month]': test.body['card[exp_month]'] || '12',
          'card[exp_year]': test.body['card[exp_year]'] || '2025',
          'card[cvc]': test.body['card[cvc]'] || '123',
        },
      }).then((response) => {
        expect(response.status).to.eq(402);
        expect(response.status).to.not.eq(200);
        expect(response.body).to.have.property('error');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});

describe('Edge Cases Payment Scenarios - Card Validation', () => {
  const paymentApiUrl = `${Cypress.env('paymentApiUrl')}payment_methods`;
  const stripeApiKey = Cypress.env('stripeApiKey');

  interface CardBody {
    'card[number]'?: string;
    'card[exp_month]'?: string;
    'card[exp_year]'?: string;
    'card[cvc]'?: string;
  }

  const ValidCardTests: { title: string; body: CardBody }[] = [
    {
      title: 'Minimum valid CVC (3-digit)',
      body: {
        'card[cvc]': '123',
      },
    },
    {
      title: 'Maximum valid CVC (4-digit for AMEX)',
      body: {
        'card[number]': '378282246310005',
        'card[cvc]': '1234',
      },
    },
  ];

  ValidCardTests.forEach((test) => {
    it(`Verify API response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: paymentApiUrl,
        headers: {
          Authorization: `Bearer ${stripeApiKey}`,
        },
        form: true,
        failOnStatusCode: false,
        body: {
          type: 'card',
          'card[number]': test.body['card[number]'] || '4242424242424242',
          'card[exp_month]': test.body['card[exp_month]'] || '12',
          'card[exp_year]': test.body['card[exp_year]'] || '2025',
          'card[cvc]': test.body['card[cvc]'],
        },
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.have.property('id');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});

describe('Verify 400 response for Empty fields and unsupported Payment Scenarios - Card Validation', () => {
  const paymentApiUrl = `${Cypress.env('paymentApiUrl')}payment_methods`;
  const stripeApiKey = Cypress.env('stripeApiKey');

  interface CardBody {
    'card[number]'?: string;
    'card[exp_month]'?: string;
    'card[exp_year]'?: string;
    'card[cvc]'?: string;
    'card[type]'?: string;
  }

  const emptyFieldTests: { title: string; body: CardBody }[] = [
    { title: 'Empty expiry month', body: { 'card[exp_month]': ' ' } },
    { title: 'Empty expiry year', body: { 'card[exp_year]': ' ' } },
    {
      title: 'No data sent in request',
      body: {
        'card[number]': '',
        'card[cvc]': '',
        'card[exp_month]': ' ',
        'card[exp_year]': ' ',
        'card[type]': '',
      },
    },
    { title: 'Unsupported payment type', body: { 'card[type]': 'bitcoin' } },
  ];

  emptyFieldTests.forEach((test) => {
    it(`Verify API response for ${test.title}`, () => {
      cy.request({
        method: 'POST',
        url: paymentApiUrl,
        headers: {
          Authorization: `Bearer ${stripeApiKey}`,
        },
        form: true,
        failOnStatusCode: false,
        body: {
          'card[type]': test.body['card[type]'] || 'card',
          'card[number]': test.body['card[number]'] || '4242424242424242',
          'card[exp_month]': test.body['card[exp_month]'] || '12',
          'card[exp_year]': test.body['card[exp_year]'] || '2025',
          'card[cvc]': test.body['card[cvc]'] || '123',
        },
      }).then((response) => {
        expect(response.status).to.not.eq(200);
        expect(response.status).to.eq(400);
        expect(response.body).to.have.property('error');
        cy.task(
          'log',
          `${test.title} - Response: ${JSON.stringify(response.body)}`
        );
      });
    });
  });
});


