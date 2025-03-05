import { APIGatewayProxyEvent } from 'aws-lambda';
import { OrangeWebhookService } from '../../../../../src/functions/webhook/orange/handler';
import { expect } from '@jest/globals';

describe('OrangeWebhookService', () => {
  let service: OrangeWebhookService;
  let mockEvent: APIGatewayProxyEvent;

  beforeEach(() => {
    service = new OrangeWebhookService();
  });

  test('should return 200 for a valid webhook event', async () => {
    const result = await service.handleWebhook(mockEvent);

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Webhook processed successfully');
  });

  test('should return 400 if body is missing', async () => {
    const invalidEvent = { ...mockEvent, body: null };
    const result = await service.handleWebhook(invalidEvent);

    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('No body found in the webhook');
  });
});
