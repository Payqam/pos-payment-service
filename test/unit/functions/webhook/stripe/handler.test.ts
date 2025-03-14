import { expect } from '@jest/globals';
import { SecretsManagerService } from '../../../../../src/services/secretsManagerService';
import { DynamoDBService } from '../../../../../src/services/dynamodbService';
import { SNSService } from '../../../../../src/services/snsService';
import { CardPaymentService } from '../../../../../src/functions/transaction-process/providers';
import { Logger } from '@mu-ts/logger';
import stripe from 'stripe';

// Mock external services
jest.mock('../../../../../src/services/secretsManagerService');
jest.mock('../../../../../src/services/dynamodbService');
jest.mock('../../../../../src/services/snsService');
jest.mock('stripe');
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mocked-uuid') }));

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const mockSecretsManagerService = new SecretsManagerService();
const mockDbService = new DynamoDBService();
const mockSnsService = {
  publish: jest.fn(),
};
(SNSService.getInstance as jest.Mock).mockReturnValue(mockSnsService);

describe('CardPaymentService', () => {
  let service: CardPaymentService;
  let mockStripeClient: jest.Mocked<stripe>;

  beforeEach(() => {
    jest.clearAllMocks();

    (SecretsManagerService as jest.Mock).mockImplementation(
      () => mockSecretsManagerService
    );
    (DynamoDBService as jest.Mock).mockImplementation(() => mockDbService);

    service = new CardPaymentService();

    mockStripeClient = {
      paymentIntents: {
        create: jest.fn().mockResolvedValue({
          id: 'mock-payment-intent-id',
          status: 'succeeded',
        }),
      },
      refunds: {
        create: jest.fn().mockResolvedValue({
          id: 'mock-refund-id',
          status: 'succeeded',
        }),
      },
    } as unknown as jest.Mocked<stripe>;

    (mockSecretsManagerService.getSecret as jest.Mock).mockResolvedValue({
      apiKey: 'mocked-api-key',
    });

    (stripe as unknown as jest.Mock).mockImplementation(() => mockStripeClient);

    jest.mock('@mu-ts/logger', () => ({
      LoggerService: {
        named: jest.fn(() => mockLogger),
      },
    }));
  });

  test('should process a successful CHARGE transaction', async () => {
    const result = await service.processCardPayment(
      1000,
      {
        paymentMethodId: 'pm_mock',
        destinationId: 'acct_mock',
      },
      'CHARGE',
      'merchant123',
      'usd'
    );

    expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledWith({
      amount: 1000,
      currency: 'usd',
      payment_method: 'pm_mock',
      confirm: true,
      transfer_data: {
        amount: 980, // after 2% fee
        destination: 'acct_mock',
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      metadata: {
        transactionId: 'mocked-uuid',
      },
    });

    expect(mockDbService.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'mocked-uuid',
        status: 'succeeded',
      })
    );

    expect(mockSnsService.publish).toHaveBeenCalled();

    expect(result).toEqual({
      transactionId: 'mocked-uuid',
      status: 'succeeded',
    });
  });

  test('should process a successful REFUND transaction', async () => {
    const result = await service.processCardPayment(
      500,
      {
        paymentIntentId: 'pi_mock',
        reason: 'requested_by_customer',
        reverse_transfer: true,
      },
      'REFUND',
      'merchant123',
      'usd'
    );

    expect(mockStripeClient.refunds.create).toHaveBeenCalledWith({
      payment_intent: 'pi_mock',
      amount: 500,
      reason: 'requested_by_customer',
      reverse_transfer: true,
    });

    expect(mockDbService.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'mock-refund-id',
        status: 'succeeded',
      })
    );

    expect(mockSnsService.publish).toHaveBeenCalled();

    expect(result).toEqual({
      transactionId: 'mock-refund-id',
      status: 'succeeded',
    });
  });

  test('should throw an error for unsupported transaction type', async () => {
    await expect(
      service.processCardPayment(
        500,
        { paymentIntentId: 'pi_mock' },
        'INVALID_TYPE',
        'merchant123',
        'usd'
      )
    ).rejects.toThrow('Unsupported transaction type: INVALID_TYPE');
  });
});
