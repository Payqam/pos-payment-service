import { APIGatewayProxyEvent } from 'aws-lambda';
import { OrangeChargeWebhookService } from '../../../../../src/functions/webhook/orange/charge/handler';
import { OrangePaymentService } from '../../../../../src/functions/transaction-process/providers';
import { DynamoDBService } from '../../../../../src/services/dynamodbService';
import { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { expect, jest, describe, test, beforeEach } from '@jest/globals';
import { PaymentResponse, PaymentInitResponse } from '../../../../../src/model';

jest.mock('../../../../../src/functions/transaction-process/providers');
jest.mock('../../../../../src/services/dynamodbService');

describe('OrangeWebhookService', () => {
  let service: OrangeChargeWebhookService;
  let mockEvent: APIGatewayProxyEvent;
  let mockOrangeService: jest.Mocked<OrangePaymentService>;
  let mockDbService: jest.Mocked<DynamoDBService>;

  beforeEach(() => {
    service = new OrangeChargeWebhookService();
    mockEvent = {
      body: JSON.stringify({
        type: 'payment_notification',
        data: {
          payToken: 'test-pay-token-123',
          status: 'SUCCESSFULL',
          transactionId: 'test-transaction-123'
        }
      }),
      headers: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/webhook/orange',
      pathParameters: null,
      queryStringParameters: null,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: ''
    };

    // Mock DynamoDBService with all required methods and properties
    const dbService = {
      logger: console,
      tableName: 'test-table',
      dbClient: {} as any,
      maxRetries: 3,
      getItem: jest.fn().mockImplementation(async () => ({
        Item: {
          transactionId: 'test-transaction-123',
          amount: 1000,
          merchantId: 'test-merchant',
          merchantMobileNo: '22501234567',
          payToken: 'test-pay-token-123'
        }
      })),
      queryByGSI: jest.fn().mockImplementation(async () => ({
        $metadata: {},
        Items: [{
          transactionId: 'test-transaction-123',
          amount: 1000,
          merchantId: 'test-merchant',
          merchantMobileNo: '22501234567',
          payToken: 'test-pay-token-123'
        }]
      } as QueryCommandOutput)),
      createPaymentRecord: jest.fn().mockImplementation(async () => {}),
      updatePaymentRecord: jest.fn().mockImplementation(async () => {}),
      deletePaymentRecord: jest.fn().mockImplementation(async () => {})
    };
    mockDbService = dbService as unknown as jest.Mocked<DynamoDBService>;

    // Mock OrangePaymentService with proper types and properties
    const successResponse: PaymentResponse = {
      message: 'Success',
      data: {
        id: 123,
        createtime: new Date().toISOString(),
        status: 'SUCCESSFULL',
        inittxnstatus: 'TXN_SUCCESS',
        subscriberMsisdn: '22501234567',
        amount: 1000,
        payToken: 'test-pay-token-123',
        txnid: 'txn-123',
        txnmode: 'USSD',
        inittxnmessage: 'Success',
        confirmtxnstatus: 'SUCCESS',
        confirmtxnmessage: 'Success',
        notifUrl: 'https://example.com/webhook',
        description: 'Test payment',
        channelUserMsisdn: '22501234567'
      }
    };

    const initResponse: PaymentInitResponse = {
      message: 'Success',
      data: { payToken: 'test-pay-token-123' }
    };

    const orangeService = {
      logger: console,
      secretsManagerService: {} as any,
      dbService: mockDbService,
      snsService: {} as any,
      getPaymentStatus: jest.fn().mockImplementation(async () => successResponse),
      initiateCashinTransaction: jest.fn().mockImplementation(async () => initResponse),
      executeCashinPayment: jest.fn().mockImplementation(async () => ({
        message: 'Success',
        data: { status: 'SUCCESSFULL' }
      } as PaymentResponse)),
      processPayment: jest.fn().mockImplementation(async () => successResponse)
    };
    mockOrangeService = orangeService as unknown as jest.Mocked<OrangePaymentService>;

    // Mock service dependencies
    (OrangePaymentService as jest.Mock).mockImplementation(() => mockOrangeService);
    (DynamoDBService as jest.Mock).mockImplementation(() => mockDbService);

    // Mock internal methods
    jest.spyOn(service as any, 'getOrangeCredentials').mockResolvedValue({
      targetEnvironment: 'sandbox',
      merchantPhone: '22501234567'
    });
  });

  test('should return 200 for a valid webhook event', async () => {
    const result = await service.handleWebhook(mockEvent);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toBe('Webhook processed successfully');
  });

  test('should return 400 if body is missing', async () => {
    const invalidEvent = { ...mockEvent, body: null };
    const result = await service.handleWebhook(invalidEvent);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing request body');
  });

  test('should return 400 for invalid webhook payload structure', async () => {
    const invalidEvent = {
      ...mockEvent,
      body: JSON.stringify({ type: 'payment_notification' }) // Missing data.payToken
    };
    const result = await service.handleWebhook(invalidEvent);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Invalid webhook payload structure');
  });

  test('should return 404 if transaction is not found', async () => {
    mockDbService.queryByGSI.mockImplementation(async () => ({
      $metadata: {},
      Items: []
    } as QueryCommandOutput));
    
    const result = await service.handleWebhook(mockEvent);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toBe('Transaction not found for payToken');
  });

  test('should handle payment pending status', async () => {
    const pendingResponse: PaymentResponse = {
      message: 'Success',
      data: {
        id: 123,
        createtime: new Date().toISOString(),
        status: 'PENDING',
        inittxnstatus: 'TXN_PENDING',
        subscriberMsisdn: '22501234567',
        amount: 1000,
        payToken: 'test-pay-token-123',
        txnid: 'txn-123',
        txnmode: 'USSD',
        inittxnmessage: 'Pending',
        confirmtxnstatus: null,
        confirmtxnmessage: null,
        notifUrl: 'https://example.com/webhook',
        description: 'Test payment',
        channelUserMsisdn: '22501234567'
      }
    };

    mockOrangeService.getPaymentStatus.mockImplementation(async () => pendingResponse);

    const result = await service.handleWebhook(mockEvent);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toBe('Payment is still pending');
  });
});
