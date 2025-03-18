import { TEST_NUMBERS, PaymentScenarioType, RefundScenarioType } from './testNumbers';

export interface PaymentScenario {
  status: string;
  txnStatus: string;
  message: string;
}

export const PAYMENT_SCENARIOS: Record<PaymentScenarioType, PaymentScenario> = {
  CUSTOMER_ACCEPTED: {
    status: 'SUCCESSFULL',
    txnStatus: '200',
    message: 'Payment successful'
  },
  CUSTOMER_DECLINED: {
    status: 'FAILED',
    txnStatus: '403',
    message: 'Customer declined payment'
  },
  INSUFFICIENT_FUNDS: {
    status: 'FAILED',
    txnStatus: '402',
    message: 'Insufficient funds'
  },
  EXPIRED_PAYMENT: {
    status: 'FAILED',
    txnStatus: '408',
    message: 'Payment request expired'
  },
  INVALID_PHONE: {
    status: 'FAILED',
    txnStatus: '400',
    message: 'Invalid phone number'
  }
};

export const REFUND_SCENARIOS: Record<RefundScenarioType, PaymentScenario> = {
  MERCHANT_DECLINED: {
    status: 'FAILED',
    txnStatus: '403',
    message: 'Merchant declined refund'
  },
  MERCHANT_ACCEPTED: {
    status: 'SUCCESSFULL',
    txnStatus: '200',
    message: 'Refund approved by merchant'
  }
};
