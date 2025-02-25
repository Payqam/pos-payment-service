import { expect } from '@jest/globals';
import { PaymentService } from '../../../../src/functions/transaction-process/paymentService';
import { KmsService } from '../../../../src/services/kmsService';
import { DynamoDBService } from '../../../../src/services/dynamodbService';
import { TransactionProcessService } from '../../../../src/functions/transaction-process/handler';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { Logger } from '@mu-ts/logger';

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(), // This prevents console.error output
  debug: jest.fn(),
  warn: jest.fn(),
} as unknown as Logger;

jest.mock('../../../../src/functions/transaction-process/paymentService');
jest.mock('../../../../src/services/kmsService');
jest.mock('../../../../src/services/dynamodbService');

const mockPaymentService = new PaymentService(mockLogger);
const mockKmsService = new KmsService();
const mockDbService = new DynamoDBService();

describe('TransactionProcessService', () => {
  let service: TransactionProcessService;

  beforeEach(() => {
    (PaymentService as jest.Mock).mockImplementation(() => mockPaymentService);
    (KmsService as jest.Mock).mockImplementation(() => mockKmsService);
    (DynamoDBService as jest.Mock).mockImplementation(() => mockDbService);

    service = new TransactionProcessService();
  });

  test('should return 400 for unsupported methods', async () => {
    const event = { httpMethod: 'PUT' } as APIGatewayProxyEvent;
    const response = await service.processTransaction(event);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Method PUT not allowed');
  });

  test('should return error for missing body in POST', async () => {
    const event = { httpMethod: 'POST', body: null } as APIGatewayProxyEvent;
    const response = await service.processTransaction(event);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Request body is missing');
  });

  test('should return error for missing amount or paymentMethod', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({}),
    } as APIGatewayProxyEvent;
    const response = await service.processTransaction(event);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      'Missing required fields: amount or paymentMethod'
    );
  });

  test('should process payment successfully', async () => {
    (mockPaymentService.processPayment as jest.Mock).mockResolvedValue('12345');
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ amount: 100, paymentMethod: 'VISA' }),
    } as APIGatewayProxyEvent;

    const response = await service.processTransaction(event);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Payment processed successfully');
    expect(response.body).toContain('12345');
  });

  test('should return error for missing transactionId in GET', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {},
    } as APIGatewayProxyEvent;
    const response = await service.processTransaction(event);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Transaction ID is required');
  });

  test('should retrieve transaction successfully', async () => {
    (mockDbService.getItem as jest.Mock).mockResolvedValue({
      transactionId: '12345',
    });
    const event = {
      httpMethod: 'GET',
      queryStringParameters: { transactionId: '12345' },
    } as Partial<APIGatewayProxyEvent> as APIGatewayProxyEvent;
    const response = await service.processTransaction(event);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Transaction retrieved successfully');
  });

  test('should return error if payment processing fails', async () => {
    (mockPaymentService.processPayment as jest.Mock).mockRejectedValue(
      new Error('Payment gateway error')
    );

    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ amount: 100, paymentMethod: 'VISA' }),
    } as APIGatewayProxyEvent;

    const response = await service.processTransaction(event);

    expect(response.statusCode).toBe(500);

    // Parse response.body to JSON
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).toBe('Failed to process request');
    expect(responseBody.details).toBe('Payment gateway error');
  });

  test('should return error when merchant details are missing for MTN', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({
        amount: 100,
        paymentMethod: 'MTN',
      }),
    } as APIGatewayProxyEvent;

    const response = await service.processTransaction(event);

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      'Missing required fields: merchantId or merchantMobileNo'
    );
  });
});
