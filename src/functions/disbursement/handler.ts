/*
/!**
 * Daily Disbursement Handler
 *
 * This lambda function is triggered by a CloudWatch Event Rule to process daily disbursements
 * for successful MTN Mobile Money transactions. The process includes:
 *
 * 1. Querying successful transactions for the current day
 * 2. Grouping transactions by merchant
 * 3. For each merchant:
 *    - Calculating total amount to be disbursed
 *    - Initiating transfer via MTN's disbursement API
 *    - Updating transaction records with settlement status
 *
 * Error Handling:
 * - Failed merchant disbursements are logged but don't stop the process
 * - Each merchant's disbursement is processed independently
 * - Transaction updates use Promise.all for parallel processing
 *
 * Monitoring:
 * - CloudWatch logs track:
 *   * Start/end of disbursement process
 *   * Successful disbursements with amounts
 *   * Failed disbursements with error details
 *   * Empty disbursement runs
 *!/

import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBService } from '../../services/dynamodbService';
import { MtnPaymentService } from '../transaction-process/providers';

const logger: Logger = LoggerService.named('daily-disbursement-handler');
const dbService = new DynamoDBService();
const mtnService = new MtnPaymentService();

export const handler = async (): Promise<void> => {
  try {
    logger.info('Starting daily disbursement process');

    // Calculate time range for today's transactions
    const now = Math.floor(Date.now() / 1000);
    const startOfDay = now - (now % 86400); // Beginning of current day
    const endOfDay = startOfDay + 86400; // End of current day

    // Query successful MTN transactions for today
    const successfulTransactions =
      await dbService.queryByPaymentMethodAndStatus(
        'mtn',
        'SUCCESS',
        startOfDay,
        endOfDay
      );

    if (!successfulTransactions.length) {
      logger.info('No successful transactions found for disbursement');
      return;
    }

    // Group transactions by merchant
    const merchantGroups = dbService.groupTransactionsByMerchant(
      successfulTransactions
    );

    // Process disbursement for each merchant
    for (const [merchantId, transactions] of Object.entries(merchantGroups)) {
      try {
        // Calculate total amount for merchant
        const totalAmount = transactions.reduce(
          (sum, tx) => sum + tx.amount,
          0
        );
        const currency = transactions[0].currency; // Assuming same currency for all transactions
        const mobileNo = transactions[0].mobileNo; // Get merchant's mobile number from first transaction

        // Initiate transfer to merchant
        const transferId = await mtnService.initiateTransfer(
          totalAmount,
          mobileNo,
          currency
        );

        // Update all transactions with settlement info
        await Promise.all(
          transactions.map((tx) =>
            dbService.updatePaymentRecord(
              { transactionId: tx.transactionId },
              {
                settlementStatus: 'PENDING',
                settlementId: transferId,
                settlementDate: Math.floor(Date.now() / 1000),
              }
            )
          )
        );

        logger.info('Created disbursement for merchant', {
          merchantId,
          transferId,
          totalAmount,
          currency,
          transactionCount: transactions.length,
        });
      } catch (error) {
        logger.error('Error processing disbursement for merchant', {
          merchantId,
          error,
        });
        // Continue with next merchant even if one fails
        continue;
      }
    }

    logger.info('Completed daily disbursement process');
  } catch (error) {
    logger.error('Error in daily disbursement process', { error });
    throw error;
  }
};
*/
