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
 * MTN sends different event types for payments and transfers,
 * but they follow the same basic structure.
 */
interface WebhookEvent {
  type: string;
  data: {
    transactionId: string;
    status: string;
    reason?: string;
    amount: string;
    currency: string;
    payerMessage?: string;
    payeeNote?: string;
  };
}

/**
 * Structure for the DynamoDB record key.
 * Used to identify the transaction record to update.
 */
interface PaymentRecordKey {
  transactionId: string;
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
  fee?: number;
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
    const transaction = await dbService.getTransactionById(transactionId);
    if (!transaction || !transaction.merchantId || !transaction.mobileNo) {
      logger.error('Invalid transaction data for instant disbursement', {
        transactionId,
        hasMerchantId: !!transaction?.merchantId,
        hasMobileNo: !!transaction?.mobileNo,
      });
      return null;
    }

    // Calculate settlement amount
    const settlementAmount = calculateSettlementAmount(amount);
    const fee = amount - settlementAmount;

    logger.info('Calculated settlement amount', {
      originalAmount: amount,
      settlementAmount,
      fee,
      feePercentage: PAYQAM_FEE_PERCENTAGE,
    });

    // Initiate transfer to merchant
    const transferId = await mtnService.initiateTransfer(
      settlementAmount,
      transaction.mobileNo,
      transaction.currency || 'EUR'
    );

    logger.info('Instant disbursement initiated', {
      transactionId,
      transferId,
      settlementAmount,
      merchantId: transaction.merchantId,
    });

    // Update transaction record with settlement info
    await dbService.updatePaymentRecord(
      { transactionId },
      {
        settlementStatus: 'INITIATED',
        settlementId: transferId,
        settlementDate: Math.floor(Date.now() / 1000),
        fee,
      }
    );

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
    const { transactionId, status, reason } = webhookEvent.data;

    // Determine transaction type from webhook event type
    const transactionType = webhookEvent.type.includes('transfer')
      ? TransactionType.TRANSFER
      : TransactionType.PAYMENT;

    logger.info('Processing webhook event', {
      transactionId,
      status,
      type: webhookEvent.type,
      transactionType,
    });

    // Verify transaction status with MTN API to prevent webhook spoofing
    const verifiedStatus = await mtnService.checkTransactionStatus(
      transactionId,
      transactionType
    );

    if (verifiedStatus !== status) {
      logger.error('Status mismatch', {
        webhookStatus: status,
        verifiedStatus,
      });
      return {
        statusCode: 400,
        headers: API.DEFAULT_HEADERS,
        body: JSON.stringify({ message: 'Status verification failed' }),
      };
    }

    // Update transaction record in DynamoDB with new status
    const key: PaymentRecordKey = { transactionId };
    const updateFields: PaymentRecordUpdate = {
      status,
      paymentProviderResponse: {
        status,
        reason,
      },
    };

    await dbService.updatePaymentRecord(key, updateFields);

    // If payment is successful and instant disbursement is enabled, process disbursement
    let settlementId: string | null = null;
    if (
      INSTANT_DISBURSEMENT_ENABLED &&
      transactionType === TransactionType.PAYMENT &&
      status === 'SUCCESS'
    ) {
      logger.info('Initiating instant disbursement', {
        transactionId,
        amount: webhookEvent.data.amount,
      });

      settlementId = await processInstantDisbursement(
        transactionId,
        parseFloat(webhookEvent.data.amount)
      );
    }

    // Publish status update to SNS for downstream processing
    const snsMessage = {
      transactionId,
      status,
      type: webhookEvent.type,
      amount: webhookEvent.data.amount,
      currency: webhookEvent.data.currency,
      reason: webhookEvent.data.reason,
      timestamp: new Date().toISOString(),
      settlementId,
    };

    await snsClient.send(
      new PublishCommand({
        TopicArn: process.env.TRANSACTION_STATUS_TOPIC_ARN,
        Message: JSON.stringify(snsMessage),
        MessageAttributes: {
          transactionType: {
            DataType: 'String',
            StringValue: transactionType,
          },
        },
      })
    );

    logger.info('Successfully processed webhook', {
      transactionId,
      status,
      type: webhookEvent.type,
      settlementId,
    });

    return {
      statusCode: 200,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({
        message: 'Webhook processed successfully',
        settlementId,
      }),
    };
  } catch (error) {
    logger.error('Error processing webhook', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      statusCode: 500,
      headers: API.DEFAULT_HEADERS,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
