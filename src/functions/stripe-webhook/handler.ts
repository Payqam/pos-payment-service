import { APIGatewayProxyHandler } from 'aws-lambda';
import { API } from '../../../configurations/api';
import getLogger from '../../internal/logger';

const logger = getLogger();

async function handlePaymentIntentSucceeded(paymentIntent: never) {
  // TODO: Implement payment success handling
  // - Update transaction status in DynamoDB
  // - Trigger success notifications
  // - Update order status
  logger.info('Payment intent succeeded', paymentIntent);
}

async function handlePaymentIntentFailed(paymentIntent: never) {
  // TODO: Implement payment failure handling
  // - Update transaction status in DynamoDB
  // - Trigger failure notifications
  // - Update order status
  logger.error('Payment intent failed', paymentIntent);
}
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    logger.info('Processing Stripe webhook', {
      path: event.path,
      httpMethod: event.httpMethod,
    });

    if (!event.body) {
      throw new Error('No event body received');
    }

    // Verify Stripe signature
    const stripeSignature = event.headers['stripe-signature'];
    if (!stripeSignature) {
      throw new Error('No Stripe signature found in headers');
    }

    // TODO: Add Stripe webhook signature verification using Secrets Manager
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    //   apiVersion: '2023-10-16',
    // });

    const webhookEvent = JSON.parse(event.body);

    // Handle different webhook events
    switch (webhookEvent.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(webhookEvent.data.object as never);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(webhookEvent.data.object as never);
        break;
      // Add more event handlers as needed
    }

    logger.info('Webhook event processed successfully', {
      type: webhookEvent.type,
      id: webhookEvent.id,
    });

    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    logger.error('Error processing webhook', { error });

    return {
      statusCode: 400,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({
        error: 'Webhook processing failed',
      }),
    };
  }
};
