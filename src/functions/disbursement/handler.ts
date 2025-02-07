import { Logger, LoggerService } from '@mu-ts/logger';
import { DynamoDBService } from '../../services/dynamodbService';
import { MtnPaymentService } from '../transaction-process/providers';

const logger: Logger = LoggerService.named('daily-disbursement-handler');
const dbService = new DynamoDBService();
const mtnService = new MtnPaymentService();

interface MerchantTransaction {
  transactionId: string;
  amount: number;
  currency: string;
  mobileNo: string;
  status: string;
  createdOn: number;
}

interface MerchantSettlement {
  merchantId: string;
  mobileNo: string;
  totalAmount: number;
  currency: string;
  transactions: string[];
}

interface DisbursementEvent {
  startTime?: number;
}

/**
 * Queries successful transactions within the specified time range.
 * Uses StatusTimeIndex GSI for efficient querying.
 *
 * @param startTime - Start timestamp in seconds
 * @param endTime - End timestamp in seconds
 * @returns Array of successful transactions
 */
async function querySuccessfulTransactions(
  startTime: number,
  endTime: number
): Promise<MerchantTransaction[]> {
  try {
    const transactions = await dbService.queryByStatusAndTime(
      'SUCCESS',
      startTime,
      endTime
    );

    logger.info('Retrieved successful transactions', {
      count: transactions.length,
      startTime,
      endTime,
    });

    return transactions as MerchantTransaction[];
  } catch (error) {
    logger.error('Failed to query successful transactions', {
      startTime,
      endTime,
      error,
    });
    throw error;
  }
}

/**
 * Groups transactions by merchant and calculates total settlement amount.
 * Uses mobile number as the merchant identifier.
 *
 * @param transactions - Array of successful transactions
 * @returns Array of merchant settlements
 */
function groupTransactionsByMerchant(
  transactions: MerchantTransaction[]
): MerchantSettlement[] {
  const merchantMap = new Map<string, MerchantSettlement>();

  for (const tx of transactions) {
    const { mobileNo, amount, currency, transactionId } = tx;

    if (!merchantMap.has(mobileNo)) {
      merchantMap.set(mobileNo, {
        merchantId: mobileNo,
        mobileNo,
        totalAmount: 0,
        currency,
        transactions: [],
      });
    }

    const settlement = merchantMap.get(mobileNo)!;
    settlement.totalAmount += amount;
    settlement.transactions.push(transactionId);
  }

  return Array.from(merchantMap.values());
}

/**
 * Processes settlement for a single merchant.
 * Initiates MTN transfer and updates transaction records.
 *
 * @param settlement - Merchant settlement details
 */
async function processSettlement(
  settlement: MerchantSettlement
): Promise<void> {
  const { merchantId, mobileNo, totalAmount, currency, transactions } =
    settlement;

  try {
    logger.info('Processing settlement for merchant', {
      merchantId,
      totalAmount,
      currency,
      transactionCount: transactions.length,
    });

    // Initiate transfer via MTN
    const transferId = await mtnService.initiateTransfer(
      totalAmount,
      mobileNo,
      currency
    );

    // Update all transactions with settlement info
    await Promise.all(
      transactions.map((txId) =>
        dbService.updatePaymentRecord(
          { transactionId: txId },
          {
            settlementStatus: 'PENDING',
            settlementId: transferId,
            settlementDate: Math.floor(Date.now() / 1000),
          }
        )
      )
    );

    logger.info('Successfully initiated settlement for merchant', {
      merchantId,
      transferId,
    });
  } catch (error) {
    logger.error('Failed to process settlement for merchant', {
      merchantId,
      error,
    });
    throw error;
  }
}

/**
 * Groups successful transactions by merchant and initiates disbursement.
 *
 * Flow:
 * 1. Queries successful transactions for the specified date range
 * 2. Groups transactions by merchant
 * 3. Calculates total amount for each merchant
 * 4. Initiates MTN transfer for each merchant
 * 5. Updates transaction records with settlement status
 *
 * Required environment variables:
 * - TRANSACTIONS_TABLE: DynamoDB table name
 * - MTN_API_SECRET: Path to MTN API secret in Secrets Manager
 *
 * @param event - Lambda event containing date range for settlement
 * @returns Summary of disbursement operations
 */
export const handler = async (
  event: DisbursementEvent
): Promise<{
  total: number;
  successful: number;
  failed: number;
}> => {
  try {
    logger.info('Starting daily disbursement process', { event });

    // Get date range from event or default to last 24 hours
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = event.startTime || endTime - 24 * 60 * 60;

    // Query successful transactions
    const transactions = await querySuccessfulTransactions(startTime, endTime);

    // Group transactions by merchant
    const merchantSettlements = groupTransactionsByMerchant(transactions);
    logger.info('Grouped transactions by merchant', {
      merchantCount: merchantSettlements.length,
    });

    // Process settlements for each merchant
    const results = await Promise.allSettled(
      merchantSettlements.map(processSettlement)
    );

    // Analyze results
    const summary = {
      total: results.length,
      successful: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };

    logger.info('Completed daily disbursement process', summary);
    return summary;
  } catch (error) {
    logger.error('Error in daily disbursement process', error);
    throw error;
  }
};
