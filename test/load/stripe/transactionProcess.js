import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

// Load unique payment methods from JSON file
const paymentMethods = new SharedArray('payment_methods', function () {
    return JSON.parse(open('./paymentMethods.json'));
});

// Create a global map for tracking payment methods used by each VU
let usedPaymentMethodIds = {};

// Custom metric to track total transaction duration (Stripe + AWS Lambda)
const transactionDurationMetric = new Trend('transaction_duration');

// Function to get a unique payment method ID
function getUniquePaymentMethodId() {
    let paymentMethodId = null;
    let totalMethods = paymentMethods.length;

    // Initialize the VU's used payment methods if it doesn't exist
    if (!usedPaymentMethodIds[__VU]) {
        usedPaymentMethodIds[__VU] = new Set();
    }

    // Loop until we get a unique payment method ID
    while (!paymentMethodId) {
        // Pick a random index
        const randomIndex = Math.floor(Math.random() * totalMethods);
        paymentMethodId = paymentMethods[randomIndex];

        // Check if the ID has been used before by this VU
        if (!usedPaymentMethodIds[__VU].has(paymentMethodId)) {
            // If it's a unique ID for this VU, mark it as used
            usedPaymentMethodIds[__VU].add(paymentMethodId);
        } else {
            // If the ID has been used, reset the paymentMethodId to null to retry
            paymentMethodId = null;
        }
    }

    return paymentMethodId;
}

export let options = {
    scenarios: {
        api_latency: {
            executor: 'constant-arrival-rate',
            rate: 100,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 20,
            maxVUs: 50,
        },
        transaction_processing: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 10,
            maxVUs: 25,
        },
        concurrent_transactions: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '10s', target: 50 },
                { duration: '10s', target: 50 },
                { duration: '10s', target: 0 },
            ],
        },
    },

    // Performance thresholds
    thresholds: {
        http_req_duration: ['p(99)<1000'],
        http_req_failed: ['rate<0.01'],
        'transaction_duration': ['p(95)<5000'],
    },
};

// API Endpoint and Key
const API_URL = 'place your api url here';
const API_KEY = 'place your api key here';

export default function () {
    let startTime = new Date();

    // Get a unique payment method ID using the updated method
    const paymentMethodId = getUniquePaymentMethodId();

    console.log(`VU ${__VU}, Iteration ${__ITER} using paymentMethodId ${paymentMethodId}`);

    let awsHeaders = {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
    };

    let awsPayload = JSON.stringify({
        merchantId: 'M123',
        amount: 120000,
        transactionType: 'CHARGE',
        paymentMethod: 'CARD',
        customerPhone: '3333',
        merchantMobileNo: '94713579023',
        currency: 'eur',
        cardData: {
            paymentMethodId: paymentMethodId,
            cardName: 'visa',
            destinationId: 'acct_1QmXUNPsBq4jlflt',
        },
        metaData: {
            deviceId: 'deviceID',
            location: 'transaction_location',
            timestamp: new Date().toISOString(),
            testId: `k6_test_${__VU}_${__ITER}`,
        },
    });

    let awsRes = http.post(API_URL, awsPayload, { 
        headers: awsHeaders,
        tags: { name: 'aws_api' },
    });

    let endTime = new Date();
    let transactionDuration = endTime - startTime;

    transactionDurationMetric.add(transactionDuration);

    check(awsRes, {
        'AWS request succeeded': (r) => r.status === 200,
        'AWS latency within limits': (r) => r.timings.duration < 5000,
        'Total transaction time within limits': () => transactionDuration < 5000,
    });

    sleep(1);
}

export function handleSummary(data) {
    return {
        "./summary.html": htmlReport(data),
        "./summary.txt": textSummary(data, { indent: " ", enableColors: true }),
        stdout: textSummary(data, { indent: " ", enableColors: true }),
    };
}
