export const PATHS = {
  FUNCTIONS: {
    TRANSACTIONS_PROCESS: '../src/functions/transaction-process',
    SALESFORCE_SYNC: '../src/functions/salesforce-sync',
    STRIPE_WEBHOOK: '../src/functions/webhook/stripe',
    ORANGE_WEBHOOK: '../src/functions/webhook/orange',
    MTN_PAYMENT_WEBHOOK: '../src/functions/webhook/mtn/payment',
    MTN_DISBURSEMENT_WEBHOOK: '../src/functions/webhook/mtn/disbursement',
    MTN_CUSTOMER_REFUND_WEBHOOK: '../src/functions/webhook/mtn/refund/customer',
    MTN_MERCHANT_REFUND_WEBHOOK: '../src/functions/webhook/mtn/refund/merchant',
    DISBURSEMENT: '../src/functions/disbursement',
    SLACK_NOTIFIER: '../src/functions/slack-notifier',
  },
} as const;
