import { expect } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { OrangeWebhookService } from '../../../../../src/webhook/orange/handler';

import { OrangePaymentService } from '../../../../../src/functions/transaction-process/providers';
import { DynamoDBService } from '../../../../../src/services/dynamodbService';
import { SNSService } from '../../../../../src/services/snsService';

import { Logger } from '@mu-ts/logger';

// Mock external services
jest.mock('../../../../src/services/dynamodbService');
jest.mock('../../../../src/services/snsService');
jest.mock(
  '../../../../src/functions/transaction-process/providers/orangePaymentService'
);
jest.mock('@mu-ts/logger');

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const mockDbService = {
  queryByGSI: jest.fn(),
  updatePaymentRecordByTransactionId: jest.fn(),
} as unknown as jest.Mocked<DynamoDBService>;

const mockSnsService = {
  publish: jest.fn(),
};

const mockOrangePaymentService = {
  getPaymentStatus: jest.fn(),
  initDisbursement: jest.fn(),
  executeDisbursement: jest.fn(),
} as unknown as jest.Mocked<OrangePaymentService>;

describe('OrangeWebhookService', () => {
  let service: OrangeWebhookService;
  let mockEvent: APIGatewayProxyEvent;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock environment variables
    process.env.TRANSACTION_STATUS_TOPIC_ARN = 'mock-topic-arn';
    process.env.ORANGE_CHANNEL_MSISDN = '1234567890';

    // Setup mocks
    (DynamoDBService as jest.Mock).mockImplementation(() => mockDbService);
    (SNSService.getInstance as jest.Mock).mockReturnValue(mockSnsService);
    (OrangePaymentService as jest.Mock).mockImplementation(
      () => mockOrangePaymentService
    );

    // Mock Logger
    jest.mock('@mu-ts/logger', () => ({
      LoggerService: {
        named: jest.fn(() => mockLogger),
      },
    }));

    service = new OrangeWebhookService();

    // Create mock event
    mockEvent = {
      body: JSON.stringify({
        type: 'payment_notification',
        data: {
          payToken: 'mock-pay-token',
          status: 'SUCCESS',
          amount: '1000',
          currency: 'XOF',
        },
      }),
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/webhook/orange',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: '',
    };

    // Setup mock responses
    mockDbService.queryByGSI.mockResolvedValue({
      Items: [
        {
          transactionId: 'mock-transaction-id',
          uniqueId: 'mock-pay-token',
          merchantMobileNo: '9876543210',
          status: 'PENDING',
        },
      ],
    });

    mockOrangePaymentService.getPaymentStatus.mockResolvedValue({
      data: {
        status: 'SUCCESS',
        inittxnstatus: 'SUCCESS',
      },
    });

    mockOrangePaymentService.initDisbursement.mockResolvedValue({
      data: {
        payToken: 'mock-disbursement-token',
      },
    });

    mockOrangePaymentService.executeDisbursement.mockResolvedValue({
      data: {
        status: 'SUCCESS',
      },
    });
  });

  test('should process a valid webhook event successfully', async () => {
    const result = await service.handleWebhook(mockEvent);

    // Verify webhook validation and transaction lookup
    expect(mockDbService.queryByGSI).toHaveBeenCalledWith(
      { uniqueId: 'mock-pay-token' },
      'GSI3'
    );

    // Verify payment status check
    expect(mockOrangePaymentService.getPaymentStatus).toHaveBeenCalledWith(
      'mock-pay-token'
    );

    // Verify disbursement was initiated
    expect(mockOrangePaymentService.initDisbursement).toHaveBeenCalled();

    // Verify disbursement was executed with correct parameters
    expect(mockOrangePaymentService.executeDisbursement).toHaveBeenCalledWith({
      channelUserMsisdn: '1234567890',
      amount: '900', // 90% of 1000
      subscriberMsisdn: '9876543210',
      orderId: 'DISB_mock-transaction-id',
      description: 'Disbursement for transaction mock-transaction-id',
      payToken: 'mock-disbursement-token',
    });

    // Verify payment record was updated
    expect(
      mockDbService.updatePaymentRecordByTransactionId
    ).toHaveBeenCalledWith(
      'mock-transaction-id',
      expect.objectContaining({
        status: 'SUCCESS',
        paymentProviderResponse: {
          status: 'SUCCESS',
          inittxnstatus: 'SUCCESS',
        },
        disbursementStatus: 'SUCCESS',
        disbursementPayToken: 'mock-disbursement-token',
        fee: 100, // 10% of 1000
        settlementAmount: 900,
        disbursementAmount: 900,
      })
    );

    // Verify SNS notification was published
    expect(mockSnsService.publish).toHaveBeenCalledWith('mock-topic-arn', {
      transactionId: 'mock-transaction-id',
      status: 'SUCCESS',
      type: 'UPDATE',
      amount: '1000',
      currency: 'XOF',
    });

    // Verify the response
    expect(result).toEqual({
      statusCode: 200,
      headers: expect.any(Object),
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    });
  });

  test('should handle missing webhook body', async () => {
    const invalidEvent = { ...mockEvent, body: null };

    const result = await service.handleWebhook(invalidEvent);

    expect(result).toEqual({
      statusCode: 400,
      headers: expect.any(Object),
      body: JSON.stringify({ error: 'No body found in the webhook' }),
    });
  });

  test('should handle invalid webhook payload format', async () => {
    const invalidEvent = { ...mockEvent, body: 'not-json' };

    const result = await service.handleWebhook(invalidEvent);

    expect(result).toEqual({
      statusCode: 400,
      headers: expect.any(Object),
      body: JSON.stringify({ error: 'Failed to parse webhook payload' }),
    });
  });

  test('should handle missing required webhook data', async () => {
    const invalidEvent = {
      ...mockEvent,
      body: JSON.stringify({
        type: 'payment_notification',
        data: {
          // Missing payToken
          status: 'SUCCESS',
          amount: '1000',
          currency: 'XOF',
        },
      }),
    };

    const result = await service.handleWebhook(invalidEvent);

    expect(result).toEqual({
      statusCode: 400,
      headers: expect.any(Object),
      body: JSON.stringify({ error: 'Invalid webhook payload' }),
    });
  });

  test('should handle transaction not found', async () => {
    mockDbService.queryByGSI.mockResolvedValueOnce({ Items: [] });

    const result = await service.handleWebhook(mockEvent);

    expect(result).toEqual({
      statusCode: 404,
      headers: expect.any(Object),
      body: JSON.stringify({ error: 'Transaction not found for payToken' }),
    });
  });

  test('should handle failed payment status', async () => {
    mockOrangePaymentService.getPaymentStatus.mockResolvedValueOnce({
      data: {
        status: 'FAILED',
        inittxnstatus: 'FAILED',
      },
    });

    const result = await service.handleWebhook(mockEvent);

    // Verify payment record was updated with FAILED status
    expect(
      mockDbService.updatePaymentRecordByTransactionId
    ).toHaveBeenCalledWith(
      'mock-transaction-id',
      expect.objectContaining({
        status: 'FAILED',
        paymentProviderResponse: {
          status: 'FAILED',
          inittxnstatus: 'FAILED',
        },
      })
    );

    // We still process disbursement in test mode regardless of status
    expect(mockOrangePaymentService.initDisbursement).toHaveBeenCalled();

    expect(result.statusCode).toBe(200);
  });

  test('should handle disbursement failure', async () => {
    mockOrangePaymentService.executeDisbursement.mockResolvedValueOnce({
      data: {
        status: 'FAILED',
      },
    });

    const result = await service.handleWebhook(mockEvent);

    // Verify payment record was updated with successful payment but failed disbursement
    expect(
      mockDbService.updatePaymentRecordByTransactionId
    ).toHaveBeenCalledWith(
      'mock-transaction-id',
      expect.objectContaining({
        status: 'SUCCESS',
        disbursementStatus: 'FAILED',
      })
    );

    expect(result.statusCode).toBe(200);
  });

  test('should handle missing merchant mobile number', async () => {
    mockDbService.queryByGSI.mockResolvedValueOnce({
      Items: [
        {
          transactionId: 'mock-transaction-id',
          uniqueId: 'mock-pay-token',
          // Missing merchantMobileNo
          status: 'PENDING',
        },
      ],
    });

    const result = await service.handleWebhook(mockEvent);

    // Verify payment record was updated with successful payment but failed disbursement
    expect(
      mockDbService.updatePaymentRecordByTransactionId
    ).toHaveBeenCalledWith(
      'mock-transaction-id',
      expect.objectContaining({
        status: 'SUCCESS',
        disbursementStatus: 'FAILED',
      })
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Merchant mobile number not found',
      expect.any(Object)
    );

    expect(result.statusCode).toBe(200);
  });

  test('should handle database errors during transaction lookup', async () => {
    mockDbService.queryByGSI.mockRejectedValueOnce(new Error('Database error'));

    const result = await service.handleWebhook(mockEvent);

    expect(result).toEqual({
      statusCode: 500,
      headers: expect.any(Object),
      body: JSON.stringify({ error: 'Failed to get transaction' }),
    });
  });

  test('should handle database errors during payment record update', async () => {
    mockDbService.updatePaymentRecordByTransactionId.mockRejectedValueOnce(
      new Error('Update error')
    );

    const result = await service.handleWebhook(mockEvent);

    expect(result).toEqual({
      statusCode: 500,
      headers: expect.any(Object),
      body: JSON.stringify({ error: 'Failed to update payment record' }),
    });
  });

  test('should handle SNS publishing errors', async () => {
    mockSnsService.publish.mockRejectedValueOnce(new Error('SNS error'));

    const result = await service.handleWebhook(mockEvent);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to publish status update',
      expect.any(Object)
    );

    expect(result).toEqual({
      statusCode: 500,
      headers: expect.any(Object),
      body: JSON.stringify({ error: 'Failed to publish status update' }),
    });
  });

  test('should handle payment pending status', async () => {
    mockOrangePaymentService.getPaymentStatus.mockResolvedValueOnce({
      data: {
        status: 'PENDING',
        inittxnstatus: 'SUCCESS',
      },
    });

    const result = await service.handleWebhook(mockEvent);

    // Verify payment record was updated with PENDING status
    expect(
      mockDbService.updatePaymentRecordByTransactionId
    ).toHaveBeenCalledWith(
      'mock-transaction-id',
      expect.objectContaining({
        status: 'PENDING',
        paymentProviderResponse: {
          status: 'PENDING',
          inittxnstatus: 'SUCCESS',
        },
      })
    );

    expect(result.statusCode).toBe(200);
  });
});
