import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger, LoggerService } from '@mu-ts/logger';
import stripe from 'stripe';
import { SecretsManagerService } from '../../../services/secretsManagerService';
import { DynamoDBService } from '../../../services/dynamodbService';
import { SNSService } from '../../../services/snsService';
import {
  CreatePaymentRecord,
  SNSMessage,
  StripeTransactionStatus,
} from '../../../model';
import { processWebhook } from './process';

export class StripeWebhookService {
  private readonly logger: Logger;

  private readonly secretsManagerService: SecretsManagerService;

  private readonly dbService: DynamoDBService;

  private readonly snsService: SNSService;

  private stripeClient!: stripe;

  private updatedAt: string;

  constructor() {
    LoggerService.setLevel('debug');
    this.logger = LoggerService.named(this.constructor.name);
    this.secretsManagerService = new SecretsManagerService();
    this.dbService = new DynamoDBService();
    this.snsService = SNSService.getInstance();
    this.updatedAt = new Date().toISOString();
    this.logger.info('init()');
  }

  public async initialize(): Promise<void> {
    const stripeSecret = await this.secretsManagerService.getSecret(
      process.env.STRIPE_API_SECRET as string
    );
    this.stripeClient = new stripe(stripeSecret.apiKey);
  }

  private async publishStatusUpdate(
    transactionId: string,
    transactionRecord: CreatePaymentRecord,
    status: string,
    updateData: Record<string, unknown>,
    originalTransactionId?: string
  ): Promise<void> {
    try {
      const paymentResponse = (updateData.refundResponse ||
        updateData.chargeResponse ||
        updateData.paymentIntentResponse) as {
        last_payment_error?: { code: string; message: string; type: string };
        failure_code?: string;
        failure_message?: string;
        outcome?: { type: string };
      };

      this.logger.info('Publishing status update', updateData);

      const isFailedStatus = [
        'INTENT_FAILED',
        'REFUND_FAILED',
        'CHARGE_FAILED',
      ].includes(status);

      let transactionError;

      if (isFailedStatus) {
        if (paymentResponse.last_payment_error) {
          transactionError = {
            ErrorCode: paymentResponse.last_payment_error.code,
            ErrorMessage: paymentResponse.last_payment_error.message,
            ErrorType: paymentResponse.last_payment_error.type,
            ErrorSource: 'POS',
          };
        } else if (
          paymentResponse.failure_code &&
          paymentResponse.failure_message
        ) {
          transactionError = {
            ErrorCode: paymentResponse.failure_code,
            ErrorMessage: paymentResponse.failure_message,
            ErrorType: paymentResponse.outcome?.type,
            ErrorSource: 'POS',
          };
        }
      }
      this.logger.info('SNS payload', {
        transactionId,
        originalTransactionId,
        updatedAt: this.updatedAt,
        status,
        transactionError,
        transactionRecord: transactionRecord,
        createdOn: this.updatedAt,
        TransactionError: transactionError,
        currency: transactionRecord?.currency,
        paymentMethod: 'Stripe',
        metaData: transactionRecord?.metaData,
        netAmount: transactionRecord?.netAmount?.toString() || '0',
        transactionType: originalTransactionId ? 'REFUND' : 'CHARGE',
        merchantMobileNo: transactionRecord?.merchantMobileNo,
      });

      await this.snsService.publish({
        transactionId: transactionId,
        originalTransactionId: originalTransactionId
          ? originalTransactionId
          : undefined,
        merchantId: transactionRecord?.merchantId,
        status,
        createdOn: this.updatedAt,
        TransactionError: transactionError,
        currency: transactionRecord?.currency,
        paymentMethod: 'Stripe',
        metaData: transactionRecord?.metaData,
        amount: originalTransactionId
          ? updateData.refundAmount
          : transactionRecord?.netAmount?.toString() || '0',
        transactionType: originalTransactionId ? 'REFUND' : 'CHARGE',
        merchantMobileNo: transactionRecord?.merchantMobileNo,
      } as SNSMessage);
    } catch (error) {
      this.logger.error('Failed to publish status update', { error });
    }
  }

  private getStatusPriority(status: StripeTransactionStatus): number {
    const priorities: Record<StripeTransactionStatus, number> = {
      INTENT_CREATE_SUCCEEDED: 1,
      INTENT_REQUIRES_PAYMENT_METHOD: 2,
      INTENT_REQUIRES_CONFIRMATION: 3,
      INTENT_REQUIRES_ACTION: 4,
      INTENT_PROCESSING: 5,
      INTENT_REQUIRES_CAPTURE: 6,
      INTENT_SUCCEEDED: 7,
      INTENT_FAILED: 8,
      INTENT_CANCELLED: 9,
      TRANSFER_CREATE_SUCCEEDED: 10,
      TRANSFER_REVERSED_SUCCEEDED: 11,
      TRANSFER_FAILED: 11,
      CHARGE_SUCCEEDED: 12,
      CHARGE_UPDATE_SUCCEEDED: 13,
      CHARGE_FAILED: 14,
      CHARGE_REFUND_SUCCEEDED: 15,
      REFUND_CREATE_SUCCEEDED: 16,
      REFUND_UPDATE_SUCCEEDED: 17,
      REFUND_CHARGE_UPDATE_SUCCEEDED: 18,
      REFUND_FAILED: 19,
    };
    return priorities[status as StripeTransactionStatus] || 0;
  }

  private async fetchPaymentIntentData(key: {
    uniqueId: string;
  }): Promise<{ latestStatus: string; updateData: Record<string, unknown> }> {
    this.logger.info('Fetching latest status from Stripe for INTENT');
    const paymentIntent = await this.stripeClient.paymentIntents.retrieve(
      key.uniqueId
    );
    this.logger.info('paymentIntent', { paymentIntent });
    const latestStatus = `INTENT_${paymentIntent.status.toUpperCase()}`;
    const updateData = {
      status: latestStatus,
      paymentIntentResponse: paymentIntent,
    };
    this.logger.info('updateData payment_intent', { updateData });
    return { latestStatus, updateData };
  }

  private async fetchRefundData(
    key: { uniqueId: string },
    newStatus: string
  ): Promise<{ latestStatus: string; updateData: Record<string, unknown> }> {
    this.logger.info('Fetching latest status from Stripe for REFUND');
    const refund = await this.stripeClient.refunds.retrieve(key.uniqueId);
    this.logger.info('refund', { refund });
    if (newStatus.startsWith('REFUND_CHARGE')) {
      this.logger.info('Fetching latest status from Stripe for REFUND_CHARGE');
      const latestStatus = `REFUND_CHARGE_UPDATE_${refund?.status?.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        refundResponse: refund,
        refundAmount: refund.amount,
      };
      return { latestStatus, updateData };
    } else if (newStatus.startsWith('REFUND_UPDATE')) {
      this.logger.info('Fetching latest status from Stripe for REFUND_UPDATE');
      const latestStatus = `REFUND_UPDATE_${refund?.status?.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        refundResponse: refund,
        refundAmount: refund.amount,
      };
      return { latestStatus, updateData };
    } else if (newStatus.startsWith('REFUND_CREATE')) {
      this.logger.info('Fetching latest status from Stripe for REFUND_CREATE');
      const latestStatus = `REFUND_UPDATE_${refund?.status?.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        refundResponse: refund,
      };
      return { latestStatus, updateData };
    } else {
      this.logger.info('Fetching latest status from Stripe for REFUND');
      const latestStatus = `REFUND_${refund?.status?.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        refundResponse: refund,
        refundAmount: refund.amount,
      };
      return { latestStatus, updateData };
    }
  }

  private async fetchChargeData(
    key: { uniqueId: string },
    newStatus: string
  ): Promise<{ latestStatus: string; updateData: Record<string, unknown> }> {
    this.logger.info('Fetching latest status from Stripe for CHARGE');
    const charge = await this.stripeClient.charges.retrieve(key.uniqueId);
    this.logger.info('charge', { charge });
    if (newStatus.startsWith('CHARGE_REFUND')) {
      this.logger.info('Fetching latest status from Stripe for CHARGE_REFUND');
      const latestStatus = `CHARGE_REFUND_${charge.status.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        chargeResponse: charge,
      };
      this.logger.info('updateData charge', { updateData });
      return { latestStatus, updateData };
    } else if (newStatus.startsWith('CHARGE_UPDATE')) {
      this.logger.info('Fetching latest status from Stripe for CHARGE_UPDATE');
      const latestStatus = `CHARGE_UPDATE_${charge.status.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        chargeResponse: charge,
      };
      this.logger.info('updateData charge', { updateData });
      return { latestStatus, updateData };
    } else {
      this.logger.info('Fetching latest status from Stripe for CHARGE');
      const latestStatus = `CHARGE_${charge.status.toUpperCase()}`;
      const updateData = {
        status: latestStatus,
        chargeResponse: charge,
      };
      this.logger.info('updateData charge', { updateData });
      return { latestStatus, updateData };
    }
  }

  private async fetchTransferData(
    key: { uniqueId: string },
    newStatus: string
  ): Promise<{ latestStatus: string; updateData: Record<string, unknown> }> {
    this.logger.info('Fetching latest status from Stripe for TRANSFER');
    const transfer = await this.stripeClient.transfers.retrieve(key.uniqueId);
    if (newStatus === 'TRANSFER_CREATE_SUCCEEDED') {
      this.logger.info(
        'Fetching latest status from Stripe for TRANSFER_CREATE_SUCCEEDED'
      );
      const latestStatus = `TRANSFER_CREATE_SUCCEEDED`;
      const updateData = {
        status: latestStatus,
        transferResponse: transfer,
      };
      this.logger.info('updateData transfer', { updateData });
      return { latestStatus, updateData };
    } else if (newStatus === 'TRANSFER_REVERSED_SUCCEEDED') {
      this.logger.info(
        'Fetching latest status from Stripe for TRANSFER_REVERSED_SUCCEEDED'
      );
      const latestStatus = `TRANSFER_REVERSED_SUCCEEDED`;
      const updateData = {
        status: latestStatus,
        transferResponse: transfer,
      };
      this.logger.info('updateData transfer', { updateData });
      return { latestStatus, updateData };
    } else {
      this.logger.info(
        'Fetching latest status from Stripe for TRANSFER_FAILED'
      );
      const latestStatus = `TRANSFER_FAILED`;
      const updateData = {
        status: latestStatus,
        transferResponse: transfer,
      };
      this.logger.info('updateData transfer', { updateData });
      return { latestStatus, updateData };
    }
  }

  private async updateRefundResponsesArray(
    transactionId: string,
    updateData: Record<string, unknown>
  ): Promise<void> {
    this.logger.info('Updating refundResponses array');
    const transactionRecord = await this.dbService.getItem({
      transactionId: transactionId,
    });

    if (transactionRecord) {
      const existingRefunds = Array.isArray(
        transactionRecord?.Item?.refundResponses
      )
        ? transactionRecord?.Item?.refundResponses
        : [];

      const cleanUpdateData = JSON.parse(JSON.stringify(updateData));
      existingRefunds?.push(cleanUpdateData);

      await this.dbService.updatePaymentRecord(
        { transactionId: transactionId },
        { refundResponses: existingRefunds }
      );
      this.logger.info('Updated refundResponses array:', {
        refundResponses: existingRefunds,
      });
    }
  }

  private async handleStatusUpdate(
    transactionId: string,
    transactionRecord: CreatePaymentRecord,
    refundId: string | undefined,
    updateData: Record<string, unknown>
  ): Promise<void> {
    await this.publishStatusUpdate(
      transactionId,
      transactionRecord,
      updateData.status as string,
      updateData
    );

    if (refundId) {
      this.logger.info('Publishing additional status update for refund', {
        refundId,
        status: updateData.status,
        amount: updateData.amount,
      });
      await this.publishStatusUpdate(
        refundId,
        transactionRecord,
        updateData.status as string,
        updateData,
        transactionId
      );
    }
  }

  private async updateRecordIfHigherStatus(
    key: { uniqueId: string },
    webHookStatus: string,
    type: 'refund' | 'charge' | 'payment_intent' | 'transfer',
    transactionId: string,
    refundId: string | undefined
  ): Promise<void> {
    try {
      this.logger.info('Fetching latest status from Stripe', { webHookStatus });

      let result: { latestStatus: string; updateData: Record<string, unknown> };

      switch (type) {
        case 'payment_intent':
          this.logger.info(
            'Fetching latest status from Stripe for PAYMENT_INTENT'
          );
          result = await this.fetchPaymentIntentData(key);
          break;
        case 'refund':
          this.logger.info('Fetching latest status from Stripe for REFUND');
          result = await this.fetchRefundData(key, webHookStatus);
          break;
        case 'charge':
          this.logger.info('Fetching latest status from Stripe for CHARGE');
          result = await this.fetchChargeData(key, webHookStatus);
          break;
        case 'transfer':
          this.logger.info('Fetching latest status from Stripe for TRANSFER');
          result = await this.fetchTransferData(key, webHookStatus);
          break;
        default:
          this.logger.info('Fetching latest status from Stripe for DEFAULT');
          this.logger.warn('Unsupported type', { type });
          return;
      }

      const { latestStatus, updateData } = result;

      if (!latestStatus) {
        this.logger.warn(
          'Could not fetch latest status from Stripe, skipping update.',
          {
            key,
            webHookStatus,
            type,
          }
        );
        return;
      }

      if (
        type === 'refund' &&
        latestStatus === 'REFUND_CHARGE_UPDATE_SUCCEEDED'
      ) {
        this.logger.info(
          'Fetching latest status from Stripe for REFUND_CHARGE_UPDATE_SUCCEEDED'
        );
        await this.dbService.updatePaymentRecord(
          { transactionId: transactionId },
          updateData
        );
        await this.updateRefundResponsesArray(transactionId, updateData);
      }

      const apiResponsePriority = this.getStatusPriority(
        latestStatus as StripeTransactionStatus
      );
      const webhookPriority = this.getStatusPriority(
        webHookStatus as StripeTransactionStatus
      );

      this.logger.info('Status priority comparison', {
        apiResponsePriority,
        webhookPriority,
        latestStatus,
        webHookStatus,
      });

      if (webhookPriority > apiResponsePriority) {
        this.logger.info('Skipping update due to lower or equal priority', {
          latestStatus,
          webHookStatus,
          apiResponsePriority,
          webhookPriority,
          transactionId,
          refundId,
        });
        return;
      }
      const transactionRecord = await this.dbService.getItem({
        transactionId: transactionId,
      });
      const netAmount = Number(transactionRecord?.Item?.netAmount) || 0;
      const refundAmount = Number(updateData.refundAmount) || 0;
      const currentAmount = netAmount - refundAmount;

      updateData.currentAmount = currentAmount;

      await this.dbService.updatePaymentRecord(
        { transactionId: transactionId },
        updateData
      );

      await this.handleStatusUpdate(
        transactionId,
        transactionRecord?.Item as CreatePaymentRecord,
        refundId,
        updateData
      );

      this.logger.info('Record updated successfully', {
        transactionId,
        status: updateData.status,
        refundId,
      });
    } catch (error) {
      this.logger.error('Failed to update record', {
        error,
        transactionId,
        refundId,
        webHookStatus,
        type,
      });
    }
  }

  public async handlePaymentEvent(
    eventObject: stripe.PaymentIntent | stripe.Charge | stripe.Refund,
    status: string
  ): Promise<void> {
    this.logger.info(`Processing event with status: ${status}`, eventObject);
    const uniqueId = eventObject.id as string;
    const type = eventObject.object as 'payment_intent' | 'charge' | 'refund';
    const transactionId = eventObject?.metadata?.transactionId;
    const refundId = eventObject?.metadata?.refundId;
    this.logger.info('handlePaymentEvent', {
      transactionId,
      uniqueId,
      type,
      refundId,
    });
    await this.updateRecordIfHigherStatus(
      { uniqueId },
      status,
      type,
      transactionId as string,
      refundId
    );
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => processWebhook(event);
