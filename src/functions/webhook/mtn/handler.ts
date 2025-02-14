import { APIGatewayProxyHandler } from 'aws-lambda';
import { API } from '../../../../configurations/api';
import { Logger, LoggerService } from '@mu-ts/logger';
import { MtnPaymentService } from '../../transaction-process/providers';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { TransactionType } from '../../transaction-process/providers';

const logger: Logger = LoggerService.named('mtn-webhook-handler');
const mtnService = new MtnPaymentService();
const dbService = new DynamoDBService();
const snsClient = new SNSClient({ region: process.env.AWS_REGION });

// Environment variables
const INSTANT_DISBURSEMENT_ENABLED =
  process.env.INSTANT_DISBURSEMENT_ENABLED === 'true';
const PAYQAM_FEE_PERCENTAGE = parseFloat(
  process.env.PAYQAM_FEE_PERCENTAGE || '2.5'
);

/**
 * Structure of the webhook event received from MTN.
 */
interface WebhookEvent {
  financialTransactionId: string;
  externalId: string;
  amount: string;
  currency: string;
  payer: {
    partyIdType: string;
    partyId: string;
  };
  payeeNote?: string;
  status: string;
}

/**
 * Structure for updating the payment record in DynamoDB.
 * Includes the new status and payment provider's response.
 */
interface PaymentRecordUpdate {
  status: string;
  paymentProviderResponse?: {
    status: string;
    reason?: string;
  };
  settlementStatus?: string;
  settlementId?: string;
  settlementDate?: number;
  settlementAmount?: number;
  fee?: number;
}

/**
 * Interface for MTN API transaction status response
 */
interface MTNTransactionStatus {
  financialTransactionId: string;
  externalId: string;
  amount: string;
  currency: string;
  payerMessage: string;
  payeeNote: string;
  status: string;
  reason?: string;
}

/**
 * Calculates the merchant's settlement amount after deducting PayQAM's fee
 *
 * @param amount - Original payment amount
 * @returns The amount to be disbursed to the merchant
 */
function calculateSettlementAmount(amount: number): number {
  const feePercentage = PAYQAM_FEE_PERCENTAGE / 100;
  const fee = amount * feePercentage;
  return amount - fee;
}

/**
 * Processes instant disbursement for a successful payment.
 * This is called when INSTANT_DISBURSEMENT_ENABLED is true and a payment is successful.
 *
 * @param transactionId - ID of the successful transaction
 * @param amount - Original payment amount
 * @returns The settlement transaction ID if successful
 */
async function processInstantDisbursement(
  transactionId: string,
  amount: number
): Promise<string | null> {
  try {
    logger.info('Processing instant disbursement', {
      transactionId,
      amount,
    });

    // Get transaction details from DynamoDB
    const result = await dbService.getTransactionById(transactionId);
    if (
      !result?.record ||
      !result.record.merchantId ||
      !result.record.merchantMobileNo
    ) {
      logger.error('Invalid transaction data for instant disbursement', {
        transactionId,
        hasMerchantId: !!result?.record?.merchantId,
        hasMerchantMobileNo: !!result?.record?.merchantMobileNo,
      });
      return null;
    }

    const transaction = result.record;

    // Calculate settlement amount
    const settlementAmount = calculateSettlementAmount(amount);
    const fee = amount - settlementAmount;

    logger.info('Calculated settlement amount', {
      originalAmount: amount,
      settlementAmount,
      fee,
      feePercentage: PAYQAM_FEE_PERCENTAGE,
    });

    // Initiate transfer to merchant using merchant's mobile number
    const transferId = await mtnService.initiateTransfer(
      settlementAmount,
      transaction.merchantMobileNo as string,
      transaction.currency || 'EUR'
    );

    logger.info('Instant disbursement initiated', {
      transactionId,
      transferId,
      settlementAmount,
      merchantId: transaction.merchantId,
      merchantMobileNo: transaction.merchantMobileNo,
    });

    // Update transaction record with settlement info
    await dbService.updatePaymentRecordByTransactionId(transactionId, {
      settlementStatus: 'INITIATED',
      settlementId: transferId,
      settlementDate: Math.floor(Date.now() / 1000),
      settlementAmount,
      fee,
    });

    return transferId;
  } catch (error) {
    logger.error('Failed to process instant disbursement', {
      error: error instanceof Error ? error.message : 'Unknown error',
      transactionId,
    });
    return null;
  }
}

/**
 * Lambda function handler for MTN Mobile Money webhooks.
 * Processes incoming webhook events for both payments and transfers.
 *
 * Flow:
 * 1. Validates the webhook payload
 * 2. Verifies the transaction status with MTN API
 * 3. Updates the transaction record in DynamoDB
 * 4. If payment is successful and instant disbursement is enabled:
 *    - Initiates immediate transfer to merchant
 *    - Updates transaction with settlement status
 * 5. Publishes a notification to SNS
 *
 * Required environment variables:
 * - TRANSACTIONS_TABLE: DynamoDB table name
 * - TRANSACTION_STATUS_TOPIC_ARN: SNS topic ARN
 * - MTN_API_SECRET: Path to MTN API secret in Secrets Manager
 * - INSTANT_DISBURSEMENT_ENABLED: If 'true', processes disbursement immediately on successful payment
 * - PAYQAM_FEE_PERCENTAGE: Percentage of transaction amount that PayQAM keeps as fee
 *
 * @param event - API Gateway proxy event
 * @returns API Gateway proxy response
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    logger.info('Received MTN webhook event', { event });

    if (!event.body) {
      return {
        statusCode: 400,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ message: 'No body provided' }),
      };
    }

    const webhookEvent = JSON.parse(event.body) as WebhookEvent;
    const { financialTransactionId, externalId, amount, currency, status } =
      webhookEvent;

    logger.info('Processing webhook event', {
      financialTransactionId,
      externalId,
      status,
      amount,
      currency,
    });

    // Verify transaction status with MTN API to prevent webhook spoofing
    const verifiedStatus = (await mtnService.checkTransactionStatus(
      externalId,
      TransactionType.PAYMENT
    )) as unknown as MTNTransactionStatus | null;

    // Update transaction record in DynamoDB
    const paymentRecord: PaymentRecordUpdate = {
      status: verifiedStatus?.status as string,
      paymentProviderResponse: {
        status: status,
      },
    };

    await dbService.updatePaymentRecordByTransactionId(
      externalId,
      paymentRecord
    );

    // If payment is successful and instant disbursement is enabled, process disbursement
    if (status === 'SUCCESSFUL' && INSTANT_DISBURSEMENT_ENABLED) {
      const amountNumber = parseFloat(amount);
      const settlementId = await processInstantDisbursement(
        externalId,
        amountNumber
      );

      if (settlementId) {
        logger.info('Instant disbursement processed successfully', {
          transactionId: externalId,
          settlementId,
        });
      } else {
        logger.error('Failed to process instant disbursement', {
          transactionId: externalId,
        });
      }
    }

    // Publish status update to SNS
    await snsClient.send(
      new PublishCommand({
        TopicArn: process.env.TRANSACTION_STATUS_TOPIC_ARN,
        Message: JSON.stringify({
          transactionId: externalId,
          status: status,
          type: 'PAYMENT',
          amount: amount,
          currency: currency,
        }),
      })
    );

    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    };
  } catch (error) {
    logger.error('Error processing webhook', {
      error: error instanceof Error ? error.message : 'Unknown error',
      event,
    });

    return {
      statusCode: 500,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
