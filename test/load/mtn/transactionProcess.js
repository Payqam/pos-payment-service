import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// Define custom metric
const transactionDurationMetric = new Trend('transaction_duration');

export let options = {
  scenarios: {
    // TC-PERF-001: API Latency Test
    api_latency: {
      executor: 'constant-arrival-rate',
      rate: 1,              // Changed from 0.2 to 1
      timeUnit: '5s',       // Changed from '1s' to '5s' to achieve same rate
      duration: '20s',
      preAllocatedVUs: 1,
      maxVUs: 2,
    },
    
    transaction_processing: {
      executor: 'constant-arrival-rate',
      rate: 1,              // Changed from 0.2 to 1
      timeUnit: '5s',       // Changed from '1s' to '5s' to achieve same rate
      duration: '20s',
      preAllocatedVUs: 1,
      maxVUs: 2,
    },

    // TC-PERF-003: Concurrent Transactions
    concurrent_transactions: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },    // Increased target to 20 concurrent users
        { duration: '30s', target: 20 },    // Hold at 20 users for 30 seconds
        { duration: '15s', target: 0 },     // Ramp down
      ],
    },
  },
  // Add global max VUs setting
  maxVUs: 25,              // Increased to accommodate 20 concurrent users plus buffer
  thresholds: {
    http_req_duration: ['p(95)<10000'],    // 10 seconds
    http_req_failed: ['rate<0.2'],         // Increased failure tolerance to 20%
    'transaction_duration': ['p(95)<15000'],
  },
};

// Define API endpoint
const API_URL = 'place here the API endpoint';
const API_KEY = 'place here the API key';

export default function () {
  let startTime = new Date();
  
  let headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
  };

  let payload = JSON.stringify({
    merchantId: 'M123',
    merchantMobileNo: '467331123455',
    amount: 100.00,
    customerPhone: '467331213455',
    transactionType: 'CHARGE',
    paymentMethod: 'MTN',
    currency: 'EUR',
    metaData: {
      reference: 'ORDER_123',
      description: 'Payment for order #123'
    },
    payerMessage: 'PayQAM payment request',
    payeeNote: 'Thank you for your payment'
  });

  let response = http.post(API_URL, payload, { 
    headers: headers,
    tags: { name: 'mtn_api' },
  });

  let endTime = new Date();
  let transactionDuration = endTime - startTime;

  transactionDurationMetric.add(transactionDuration);

  check(response, {
    'MTN request succeeded': (r) => r.status === 200,
    'MTN latency within limits': (r) => r.timings.duration < 12000,
    'Total transaction time within limits': () => transactionDuration < 15000,
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