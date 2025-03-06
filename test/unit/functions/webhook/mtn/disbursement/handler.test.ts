import { expect } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { MTNDisbursementWebhookService } from '../../../../../../src/functions/webhook/mtn/disbursement/handler';
import { DynamoDBService } from '../../../../../../src/services/dynamodbService';
import { SNSService } from '../../../../../../src/services/snsService';
import {
  MtnPaymentService,
  TransactionType,
} from '../../../../../../src/functions/transaction-process/providers';
import {
  WebhookEvent,
  MTN_TRANSFER_ERROR_MAPPINGS,
} from '../../../../../../src/types/mtn';
import { Logger } from '@mu-ts/logger';

// Mock external services
jest.mock('../../../../../../src/services/dynamodbService');
jest.mock('../../../../../../src/services/snsService');
jest.mock('../../../../../../src/functions/transaction-process/providers');

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const mockDbService = new DynamoDBService();
const mockSnsService = {
  publish: jest.fn(),
};
(SNSService.getInstance as jest.Mock).mockReturnValue(mockSnsService);

const mockMtnService = {
  checkTransactionStatus: jest.fn(),
} as unknown as jest.Mocked<MtnPaymentService>;

describe('MTNDisbursementWebhookService', () => {
  let service: MTNDisbursementWebhookService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();

    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      TRANSACTION_STATUS_TOPIC_ARN: 'mock-topic-arn',
    };

    (DynamoDBService as jest.Mock).mockImplementation(() => mockDbService);
    (MtnPaymentService as jest.Mock).mockImplementation(() => mockMtnService);

    service = new MTNDisbursementWebhookService();

    jest.mock('@mu-ts/logger', () => ({
      LoggerService: {
        named: jest.fn(() => mockLogger),
      },
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockEvent = (body: object): APIGatewayProxyEvent => {
    return {
      body: JSON.stringify(body),
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/webhook',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as unknown as APIGatewayProxyEvent['requestContext'],
      resource: '',
    };
  };

  test('should process a successful disbursement webhook', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transfer-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payeeNote: 'Disbursement successful',
      payerMessage: 'Thank you for your service',
      payee: {
        partyIdType: 'MSISDN',
        partyId: '123456789',
      },
    };

    // Mock transaction status response
    const transactionStatusResponse: WebhookEvent = {
      ...webhookEvent,
      status: 'SUCCESSFUL',
    };

    // Mock database responses
    (mockDbService.queryByGSI as jest.Mock).mockResolvedValue({
      Items: [{ transactionId: 'transaction-123' }],
    });

    (mockMtnService.checkTransactionStatus as jest.Mock).mockResolvedValue(
      transactionStatusResponse
    );

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify database operations
    expect(mockDbService.queryByGSI).toHaveBeenCalledWith(
      { uniqueId: 'transfer-123' },
      'GSI3'
    );

    expect(mockDbService.updatePaymentRecord).toHaveBeenCalledWith(
      { transactionId: 'transaction-123' },
      expect.objectContaining({
        settlementStatus: 'SUCCESSFUL',
        settlementResponse: {
          status: 'SUCCESSFUL',
          financialTransactionId: 'ft-123456789',
          payeeNote: 'Disbursement successful',
          payerMessage: 'Thank you for your service',
        },
      })
    );

    // Verify transaction status check
    expect(mockMtnService.checkTransactionStatus).toHaveBeenCalledWith(
      'transfer-123',
      TransactionType.TRANSFER
    );

    // Verify response
    expect(result).toEqual({
      statusCode: 200,
      headers: expect.any(Object),
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    });
  });

  test('should process a failed disbursement webhook', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transfer-123',
      amount: '1000',
      currency: 'USD',
      status: 'FAILED',
      reason: 'PAYEE_NOT_FOUND',
      payee: {
        partyIdType: 'MSISDN',
        partyId: '123456789',
      },
    };

    // Mock transaction status response
    const transactionStatusResponse: WebhookEvent = {
      ...webhookEvent,
      status: 'FAILED',
    };

    // Mock database responses
    (mockDbService.queryByGSI as jest.Mock).mockResolvedValue({
      Items: [{ transactionId: 'transaction-123' }],
    });

    (mockMtnService.checkTransactionStatus as jest.Mock).mockResolvedValue(
      transactionStatusResponse
    );

    // Mock error mappings
    (MTN_TRANSFER_ERROR_MAPPINGS as any).PAYEE_NOT_FOUND = {
      statusCode: 404,
      message: 'Payee account was not found',
      retryable: false,
      suggestedAction: 'Verify mobile number',
    };

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify database operations
    expect(mockDbService.queryByGSI).toHaveBeenCalledWith(
      { uniqueId: 'transfer-123' },
      'GSI3'
    );

    expect(mockDbService.updatePaymentRecord).toHaveBeenCalledWith(
      { transactionId: 'transaction-123' },
      expect.objectContaining({
        settlementStatus: 'FAILED',
        settlementResponse: expect.objectContaining({
          status: 'FAILED',
          reason: 'PAYEE_NOT_FOUND',
          retryable: false,
          suggestedAction: 'Verify mobile number',
          httpStatus: 404,
        }),
      })
    );

    // Verify transaction status check
    expect(mockMtnService.checkTransactionStatus).toHaveBeenCalledWith(
      'transfer-123',
      TransactionType.TRANSFER
    );

    // Verify response
    expect(result).toEqual({
      statusCode: 200,
      headers: expect.any(Object),
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    });
  });

  test('should handle invalid webhook payload', async () => {
    // Create event with missing required fields
    const webhookEvent = {
      externalId: 'transfer-123',
      // Missing amount, currency, status
    };

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify error response
    expect(result).toEqual({
      statusCode: 400,
      headers: expect.any(Object),
      body: JSON.stringify({
        message: 'Invalid webhook payload',
      }),
    });
  });

  test('should handle empty event body', async () => {
    // Create event with null body
    const event = {
      ...createMockEvent({}),
      body: null,
    };

    // Execute the webhook handler
    const result = await service.processWebhook(event);

    // Verify error response
    expect(result).toEqual({
      statusCode: 400,
      headers: expect.any(Object),
      body: JSON.stringify({
        message: 'No body provided in webhook',
      }),
    });
  });

  test('should handle transaction not found', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transfer-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payee: {
        partyIdType: 'MSISDN',
        partyId: '123456789',
      },
    };

    // Mock database response - transaction not found
    (mockDbService.queryByGSI as jest.Mock).mockResolvedValue({
      Items: [],
    });

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify error response
    expect(result).toEqual({
      statusCode: 404,
      headers: expect.any(Object),
      body: JSON.stringify({
        message: 'Transaction not found: transfer-123',
      }),
    });
  });

  test('should handle database update errors', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transfer-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payeeNote: 'Disbursement successful',
      payee: {
        partyIdType: 'MSISDN',
        partyId: '123456789',
      },
    };

    // Mock transaction status response
    const transactionStatusResponse: WebhookEvent = {
      ...webhookEvent,
      status: 'SUCCESSFUL',
    };

    // Mock database responses
    (mockDbService.queryByGSI as jest.Mock).mockResolvedValue({
      Items: [{ transactionId: 'transaction-123' }],
    });

    (mockMtnService.checkTransactionStatus as jest.Mock).mockResolvedValue(
      transactionStatusResponse
    );

    // Mock update failure
    (mockDbService.updatePaymentRecord as jest.Mock).mockRejectedValue(
      new Error('Database update failed')
    );

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify error response with 500 status code
    expect(result).toEqual({
      statusCode: 500,
      headers: expect.any(Object),
      body: expect.stringContaining('Internal server error'),
    });
  });

  test('should handle transaction status check errors', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transfer-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payee: {
        partyIdType: 'MSISDN',
        partyId: '123456789',
      },
    };

    // Mock database responses
    (mockDbService.queryByGSI as jest.Mock).mockResolvedValue({
      Items: [{ transactionId: 'transaction-123' }],
    });

    // Mock transaction status check failure
    (mockMtnService.checkTransactionStatus as jest.Mock).mockRejectedValue(
      new Error('Transaction status check failed')
    );

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify error response with 500 status code
    expect(result).toEqual({
      statusCode: 500,
      headers: expect.any(Object),
      body: expect.stringContaining('Internal server error'),
    });
  });
});
