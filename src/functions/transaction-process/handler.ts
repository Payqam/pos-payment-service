import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { API } from '../../../configurations/api';
import {
  processCardPayment,
  processMTNPayment,
  processOrangePayment,
} from './payment-providers';
import getLogger from '../../internal/logger';

const logger = getLogger();

// Transaction fee constants
const CARD_FEE = 100; // Fee for card transactions in CFA
const MOBILE_MONEY_FEE = 50; // Fee for mobile money transactions in CFA

// Payment processing function
const processPayment = async (transaction: {
  amount: number;
  paymentMethod: string;
  cardData?: Record<string, unknown>;
  customerPhone?: string;
}): Promise<string> => {
  const { amount, paymentMethod, cardData, customerPhone } = transaction;

  switch (paymentMethod) {
    case 'CARD': {
      if (!cardData) {
        throw new Error('Missing card data for card payment');
      }
      logger.info('Processing card payment');
      const cardAmount = amount - CARD_FEE;
      return processCardPayment(cardAmount, CARD_FEE, cardData);
    }
    case 'MOMO': {
      if (!customerPhone) {
        throw new Error(
          'Missing customer phone number for mobile money payment'
        );
      }
      logger.info('Processing MTN Mobile Money payment');
      const mtnAmount = amount + MOBILE_MONEY_FEE;
      return processMTNPayment(mtnAmount, MOBILE_MONEY_FEE, customerPhone);
    }
    case 'ORANGE': {
      if (!customerPhone) {
        throw new Error(
          'Missing customer phone number for Orange Money payment'
        );
      }
      logger.info('Processing Orange Money payment');
      const orangeAmount = amount + MOBILE_MONEY_FEE;
      return processOrangePayment(
        orangeAmount,
        MOBILE_MONEY_FEE,
        customerPhone
      );
    }
    default: {
      throw new Error(`Unsupported payment method: ${paymentMethod}`);
    }
  }
};

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    logger.info('Received event:', JSON.stringify(event, null, 2));

    const body = JSON.parse(event.body || '{}');

    // Validate required fields
    const { amount, paymentMethod, cardData, customerPhone } = body;
    if (!amount || !paymentMethod) {
      return {
        statusCode: 400,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({
          error: 'Missing required fields: amount or paymentMethod',
        }),
      };
    }

    // Process payment based on the provided payment method
    const transactionResult = await processPayment({
      amount,
      paymentMethod,
      cardData,
      customerPhone,
    });

    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({
        message: 'Payment processed successfully',
        result: transactionResult,
      }),
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Error processing transaction:', error);
    } else {
      logger.error('Error processing transaction:', String(error));
    }
    return {
      statusCode: 500,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({
        error: 'Failed to process payment',
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
