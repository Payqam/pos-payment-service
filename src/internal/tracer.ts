import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { captureAWSv3Client } from 'aws-xray-sdk-core';

// Initialize tracer
export const tracer = new Tracer({
  serviceName: 'pos-payment-service',
  enabled: true,
});

// Helper function to instrument AWS SDK v3 clients
export function getInstrumentedClients() {
  const dynamoClient = captureAWSv3Client(new DynamoDBClient({}));
  const secretsClient = captureAWSv3Client(new SecretsManagerClient({}));

  return {
    dynamoClient,
    secretsClient,
  };
}

// Helper function to create custom subsegments
export function createCustomSegment<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment(name);

  return new Promise<T>((resolve, reject) => {
    operation()
      .then((result) => {
        subsegment?.close();
        resolve(result);
      })
      .catch((error) => {
        subsegment?.addError(error);
        subsegment?.close();
        reject(error);
      });
  });
}
