const fs = require('fs');
const axios = require('axios');

const STRIPE_URL = 'https://api.stripe.com/v1/payment_methods';
const STRIPE_SECRET = 'pk_test_51Qm8InLS3EJLWOAq2cddaXFyFDaeAN1e0nUCXd6sevCWMUgBWQYP56zE9A8uwqus4Ib9it4uRGXbCTCJQxpElDs300mme80dCm';

async function generatePaymentMethods() {
    const paymentMethods = [];
    const batchSize = 10; // Number of concurrent requests
    const totalMethods = 10000; // Total number of payment methods to generate

    for (let i = 0; i < totalMethods; i += batchSize) {
        const batchRequests = [];

        for (let j = 0; j < batchSize && i + j < totalMethods; j++) {
            batchRequests.push(
                axios.post(STRIPE_URL, new URLSearchParams({
                    type: 'card',
                    'card[number]': '4242424242424242',
                    'card[exp_month]': '12',
                    'card[exp_year]': '2025',
                    'card[cvc]': '123',
                }), {
                    headers: {
                        Authorization: `Bearer ${STRIPE_SECRET}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                })
            );
        }

        try {
            const responses = await Promise.all(batchRequests);
            responses.forEach(res => {
                if (res.status === 200) {
                    paymentMethods.push(res.data.id);
                }
            });
        } catch (error) {
            console.error('Error creating payment method:', error);
        }
    }

    fs.writeFileSync('d:/QM projects/PAY-QAM/pos-payment-service/test/load/stripe/paymentMethods.json', JSON.stringify(paymentMethods));
    console.log('File saved to: d:/QM projects/PAY-QAM/pos-payment-service/test/load/stripe/paymentMethods.json');
}

generatePaymentMethods();