import { expect } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { MTNPaymentWebhookService } from '../../../../../../src/functions/webhook/mtn/payment/handler';
import { DynamoDBService } from '../../../../../../src/services/dynamodbService';
import { SNSService } from '../../../../../../src/services/snsService';
import {
  MtnPaymentService,
  TransactionType,
} from '../../../../../../src/functions/transaction-process/providers';
import { WebhookEvent } from '../../../../../../src/types/mtn';
import { Logger } from '@mu-ts/logger';

// Mock external services
jest.mock('../../../../../../src/services/dynamodbService');
jest.mock('../../../../../../src/services/snsService');
jest.mock('../../../../../../src/functions/transaction-process/providers');
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mocked-uuid') }));

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
  initiateTransfer: jest.fn(),
  callWebhook: jest.fn(),
} as unknown as jest.Mocked<MtnPaymentService>;

describe('MTNPaymentWebhookService', () => {
  let service: MTNPaymentWebhookService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();

    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      PAYQAM_FEE_PERCENTAGE: '2.5',
      INSTANT_DISBURSEMENT_ENABLED: 'true',
      TRANSACTION_STATUS_TOPIC_ARN: 'mock-topic-arn',
      MTN_TARGET_ENVIRONMENT: 'sandbox',
      MTN_DISBURSEMENT_WEBHOOK_URL: 'https://mock-webhook-url.com',
    };

    (DynamoDBService as jest.Mock).mockImplementation(() => mockDbService);
    (MtnPaymentService as jest.Mock).mockImplementation(() => mockMtnService);

    service = new MTNPaymentWebhookService();

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

  test('should process a successful payment webhook', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transaction-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payeeNote: 'Payment successful',
      payee: {
        partyIdType: 'MSISDN',
        partyId: '123456789',
      },
      payerMessage: 'Thank you for your payment',
    };

    // Mock transaction status response
    const transactionStatusResponse: WebhookEvent = {
      ...webhookEvent,
      status: 'SUCCESSFUL',
    };

    // Mock database responses
    (mockDbService.getItem as jest.Mock).mockResolvedValue({
      Item: {
        transactionId: 'transaction-123',
        merchantMobileNo: '987654321',
      },
    });

    (mockMtnService.checkTransactionStatus as jest.Mock).mockResolvedValue(
      transactionStatusResponse
    );

    (mockMtnService.initiateTransfer as jest.Mock).mockResolvedValue(
      'transfer-123'
    );

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify correct calculation of settlement amount (1000 - 2.5% = 975)
    const expectedSettlementAmount = 975;

    // Verify DynamoDB operations
    expect(mockDbService.getItem).toHaveBeenCalledWith({
      transactionId: 'transaction-123',
    });

    expect(mockDbService.updatePaymentRecord).toHaveBeenCalledWith(
      { transactionId: 'transaction-123' },
      expect.objectContaining({
        status: 'SUCCESSFUL',
        paymentProviderResponse: {
          status: 'SUCCESSFUL',
          reason: 'Payment successful',
        },
        fee: 25,
        uniqueId: 'transfer-123',
        settlementStatus: 'PENDING',
        settlementAmount: expectedSettlementAmount,
      })
    );

    // Verify SNS notification
    expect(mockSnsService.publish).toHaveBeenCalledWith(
      'mock-topic-arn',
      expect.objectContaining({
        transactionId: 'transaction-123',
        status: 'SUCCESSFUL',
        type: 'PAYMENT',
        amount: '1000',
        currency: 'USD',
        uniqueId: 'transfer-123',
        settlementStatus: 'PENDING',
      })
    );

    // Verify sandbox disbursement webhook call
    expect(mockMtnService.callWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        financialTransactionId: 'mocked-uuid',
        externalId: 'transfer-123',
        amount: '1000',
        currency: 'USD',
        status: 'SUCCESSFUL',
      }),
      TransactionType.TRANSFER
    );

    // Verify response
    expect(result).toEqual({
      statusCode: 200,
      headers: expect.any(Object),
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    });
  });

  test('should process a failed payment webhook', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transaction-123',
      amount: '1000',
      currency: 'USD',
      status: 'FAILED',
      reason: 'PAYER_NOT_FOUND',
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
    (mockDbService.getItem as jest.Mock).mockResolvedValue({
      Item: {
        transactionId: 'transaction-123',
      },
    });

    (mockMtnService.checkTransactionStatus as jest.Mock).mockResolvedValue(
      transactionStatusResponse
    );

    // Mock error mappings
    jest.mock('../../../../../../src/types/mtn', () => ({
      MTN_REQUEST_TO_PAY_ERROR_MAPPINGS: {
        PAYER_NOT_FOUND: {
          statusCode: 404,
          message: 'Payer account was not found',
          retryable: false,
          suggestedAction: 'Verify mobile number',
        },
      },
      MTNRequestToPayErrorReason: {
        PAYER_NOT_FOUND: 'PAYER_NOT_FOUND',
      },
    }));

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify DynamoDB operations
    expect(mockDbService.getItem).toHaveBeenCalledWith({
      transactionId: 'transaction-123',
    });

    // Verify transaction status check
    expect(mockMtnService.checkTransactionStatus).toHaveBeenCalledWith(
      'transaction-123',
      TransactionType.PAYMENT
    );

    // Verify SNS notification
    expect(mockSnsService.publish).toHaveBeenCalledWith(
      'mock-topic-arn',
      expect.objectContaining({
        transactionId: 'transaction-123',
        status: 'FAILED',
        type: 'PAYMENT',
        amount: '1000',
        currency: 'USD',
      })
    );

    // Verify response
    expect(result).toEqual({
      statusCode: 200,
      headers: expect.any(Object),
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    });
  });

  test('should handle invalid webhook payload', async () => {
    // Missing required fields
    const webhookEvent = {
      externalId: 'transaction-123',
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

  test('should handle transaction not found', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transaction-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payee: {
        partyIdType: 'MSISDN',
        partyId: '123456789',
      },
    };

    // Mock database response - transaction not found
    (mockDbService.getItem as jest.Mock).mockResolvedValue(null);

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify error response
    expect(result).toEqual({
      statusCode: 404,
      headers: expect.any(Object),
      body: JSON.stringify({
        message: 'Transaction not found: transaction-123',
      }),
    });
  });

  test('should handle disbursement failure but still process payment success', async () => {
    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transaction-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payeeNote: 'Payment successful',
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
    (mockDbService.getItem as jest.Mock).mockResolvedValue({
      Item: {
        transactionId: 'transaction-123',
        merchantMobileNo: '987654321',
      },
    });

    (mockMtnService.checkTransactionStatus as jest.Mock).mockResolvedValue(
      transactionStatusResponse
    );

    // Mock disbursement failure
    (mockMtnService.initiateTransfer as jest.Mock).mockRejectedValue(
      new Error('Transfer initiation failed')
    );

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify that payment was still processed successfully
    expect(mockDbService.updatePaymentRecord).toHaveBeenCalledWith(
      { transactionId: 'transaction-123' },
      expect.objectContaining({
        status: 'SUCCESSFUL',
        paymentProviderResponse: {
          status: 'SUCCESSFUL',
          reason: 'Payment successful',
        },
        fee: 25,
      })
    );

    // Verify that uniqueId and settlement fields are not present
    expect(mockDbService.updatePaymentRecord).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        uniqueId: expect.anything(),
        settlementStatus: expect.anything(),
      })
    );

    // Verify SNS notification still sent
    expect(mockSnsService.publish).toHaveBeenCalled();

    // Verify response
    expect(result).toEqual({
      statusCode: 200,
      headers: expect.any(Object),
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    });
  });

  test('should handle disabled instant disbursement', async () => {
    // Update environment to disable instant disbursement
    process.env.INSTANT_DISBURSEMENT_ENABLED = 'false';

    // Create new service instance with updated config
    service = new MTNPaymentWebhookService();

    // Mock webhook event
    const webhookEvent: WebhookEvent = {
      financialTransactionId: 'ft-123456789',
      externalId: 'transaction-123',
      amount: '1000',
      currency: 'USD',
      status: 'SUCCESSFUL',
      payeeNote: 'Payment successful',
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
    (mockDbService.getItem as jest.Mock).mockResolvedValue({
      Item: {
        transactionId: 'transaction-123',
        merchantMobileNo: '987654321',
      },
    });

    (mockMtnService.checkTransactionStatus as jest.Mock).mockResolvedValue(
      transactionStatusResponse
    );

    // Execute the webhook handler
    const result = await service.processWebhook(createMockEvent(webhookEvent));

    // Verify update doesn't contain disbursement data
    expect(mockDbService.updatePaymentRecord).toHaveBeenCalledWith(
      { transactionId: 'transaction-123' },
      expect.objectContaining({
        status: 'SUCCESSFUL',
        paymentProviderResponse: {
          status: 'SUCCESSFUL',
          reason: 'Payment successful',
        },
        fee: 25,
      })
    );

    // Verify initiateTransfer was not called
    expect(mockMtnService.initiateTransfer).not.toHaveBeenCalled();

    // Verify response
    expect(result).toEqual({
      statusCode: 200,
      headers: expect.any(Object),
      body: JSON.stringify({ message: 'Webhook processed successfully' }),
    });
  });
});
