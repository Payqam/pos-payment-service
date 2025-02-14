export const PATHS = {
  FUNCTIONS: {
    TRANSACTIONS_PROCESS: '../src/functions/transaction-process',
    SALESFORCE_SYNC: '../src/functions/salesforce-sync',
    STRIPE_WEBHOOK: '../src/functions/webhook/stripe',
    ORANGE_WEBHOOK: '../src/functions/webhook/orange',
    MTN_WEBHOOK: '../src/functions/webhook/mtn',
    DISBURSEMENT: '../src/functions/disbursement',
    SLACK_NOTIFIER: '../src/functions/slack-notifier',
  },
} as const;
