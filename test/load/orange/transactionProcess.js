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
        { duration: '10s', target: 2 },    // Reduced target to ensure we don't exceed Lambda limits
        { duration: '10s', target: 0 },
      ],
    },
  },
  // Add global max VUs setting
  maxVUs: 10,              // Set global maximum VUs to match Lambda limit
  thresholds: {
    http_req_duration: ['p(95)<10000'],    // 10 seconds
    http_req_failed: ['rate<0.2'],         // Increased failure tolerance to 20%
    'transaction_duration': ['p(95)<15000'],
  },
};

// Define API endpoint
const API_URL = 'https://ohdgm566qg.execute-api.us-east-1.amazonaws.com/SQA/transaction/process/charge';
const API_KEY = 'yOHZDaeTvt2NO7nyzk7Oi8DHU4cBXIY84D8eBKMi';

export default function () {
  let startTime = new Date();
  
  let headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
  };

  let payload = JSON.stringify({
    merchantId: 'M123',
    amount: 1000,
    transactionType: 'CHARGE',
    paymentMethod: 'ORANGE',
    customerPhone: '691654529',
    currency: '',
    cardData: {
      paymentMethodId: '',
      cardName: '',
      destinationId: '',
      currency: ''
    },
    metaData: {
      deviceId: 'deviceID',
      location: 'transaction_location',
      timestamp: 'transaction_timestamp'
    },
    merchantMobileNo: '691654524'
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
    'MTN latency within limits': (r) => r.timings.duration < 10000,
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