import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Logger } from '@mu-ts/logger';

const secretsManagerClient = new SecretsManagerClient({ region: 'us-east-1' });

const getSecret = async (
  secretName: string,
  logger: Logger
): Promise<Record<string, string>> => {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await secretsManagerClient.send(command);

    if (response.SecretString) {
      return JSON.parse(response.SecretString);
    } else {
      throw new Error(`Secret ${secretName} has no secret string.`);
    }
  } catch (error: unknown) {
    logger.error(`Error fetching secret ${secretName}:`, error as Error);
    throw error;
  }
};
// Card Payment (Stripe)
export const processCardPayment = async (
  amount: number,
  fee: number,
  cardData: Record<string, unknown>,
  logger: Logger
): Promise<string> => {
  logger.info('Processing card payment', { amount, fee, cardData });
  const stripeSecretName = process.env.STRIPE_API_SECRET as string;
  const stripeSecret = await getSecret(stripeSecretName, logger);
  logger.info('Stripe secret:', stripeSecret);
  // TODO: Call Stripe API here
  return 'Card payment successful';
};

// MTN Mobile Money
export const processMTNPayment = async (
  amount: number,
  fee: number,
  mobileNo: string,
  logger: Logger
): Promise<string> => {
  logger.info('Processing MTN payment', { amount, fee, mobileNo });
  const mtnSecretName = process.env.MTN_API_SECRET as string;
  const mtnSecret = await getSecret(mtnSecretName, logger);
  logger.info('MTN secret:', mtnSecret);
  // TODO: Call MTN REST API here
  return 'MTN payment successful';
};

// Orange Money
export const processOrangePayment = async (
  amount: number,
  fee: number,
  mobileNo: string,
  logger: Logger
): Promise<string> => {
  logger.info('Processing Orange payment', { amount, fee, mobileNo });
  const orangeSecretName = process.env.ORANGE_API_SECRET as string;
  const orangeSecret = await getSecret(orangeSecretName, logger);
  logger.info('Orange secret:', orangeSecret);
  // TODO:Call Orange Money API here
  return 'Orange payment successful';
};
