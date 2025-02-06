import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Represents a value that can be stored in AWS Secrets Manager.
 * Supports nested structures for complex configurations like payment provider credentials.
 */
export type SecretValue = string | number | boolean | SecretValueObject;

/**
 * Represents a nested object structure that can be stored in AWS Secrets Manager.
 * Used for complex configurations like:
 * - MTN Mobile Money (separate collection/disbursement credentials)
 * - Stripe (API keys and webhook secrets)
 *
 * Example MTN structure:
 * ```typescript
 * {
 *   collection: {
 *     subscriptionKey: string;
 *     apiUser: string;
 *     apiKey: string;
 *   },
 *   disbursement: {
 *     subscriptionKey: string;
 *     apiUser: string;
 *     apiKey: string;
 *   },
 *   targetEnvironment: string;
 * }
 * ```
 */
export interface SecretValueObject {
  [key: string]: SecretValue;
}

/**
 * Configuration for creating a secret in AWS Secrets Manager.
 * Supports both flat and nested secret structures.
 */
export interface SecretConfig {
  /**
   * Name of the secret in AWS Secrets Manager.
   * Should follow the pattern: SERVICE_NAME-ENVIRONMENT-NAMESPACE
   */
  secretName: string;

  /**
   * Optional description of the secret's purpose
   */
  description?: string;

  /**
   * The secret values to store.
   * Can be a flat key-value structure or a nested object.
   */
  secretValues: SecretValueObject;
}

/**
 * Helper class for managing secrets in AWS Secrets Manager.
 * Provides functionality to create and validate secrets with complex structures.
 */
export class SecretsManagerHelper {
  /**
   * Creates a new secret in AWS Secrets Manager.
   *
   * Features:
   * - Supports nested secret structures
   * - Validates all secret values before creation
   * - Generates a unique secret string
   *
   * @param scope - The CDK construct scope
   * @param config - Configuration for the secret
   * @returns The created AWS Secrets Manager secret
   *
   * @example
   * ```typescript
   * const mtnSecret = SecretsManagerHelper.createSecret(this, {
   *   secretName: 'MTN_API_SECRET-prod-pos',
   *   description: 'MTN Mobile Money API credentials',
   *   secretValues: {
   *     collection: {
   *       subscriptionKey: process.env.MTN_COLLECTION_SUBSCRIPTION_KEY,
   *       apiUser: process.env.MTN_COLLECTION_API_USER,
   *       apiKey: process.env.MTN_COLLECTION_API_KEY,
   *     },
   *     disbursement: {
   *       subscriptionKey: process.env.MTN_DISBURSEMENT_SUBSCRIPTION_KEY,
   *       apiUser: process.env.MTN_DISBURSEMENT_API_USER,
   *       apiKey: process.env.MTN_DISBURSEMENT_API_KEY,
   *     },
   *     targetEnvironment: 'sandbox',
   *   },
   * });
   * ```
   */
  public static createSecret(
    scope: Construct,
    config: SecretConfig
  ): secretsmanager.Secret {
    // Validate secret values before creation
    this.validateSecretValues(config.secretValues);

    // Create the secret
    return new secretsmanager.Secret(scope, `${config.secretName}Secret`, {
      secretName: config.secretName,
      description: config.description,
      generateSecretString: {
        secretStringTemplate: JSON.stringify(config.secretValues),
        generateStringKey: 'unused',
      },
    });
  }

  /**
   * Validates the structure and types of secret values.
   * Ensures all values in the object (including nested objects) are of valid types.
   *
   * Valid types:
   * - string: For API keys, tokens, and other credentials
   * - number: For configuration values like timeouts or limits
   * - boolean: For feature flags or toggles
   * - object: For nested configurations
   *
   * @param values - The secret values to validate
   * @throws Error if any value has an invalid type
   */
  private static validateSecretValues(values: SecretValueObject): void {
    Object.entries(values).forEach(([key, value]) => {
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean' &&
        typeof value !== 'object'
      ) {
        throw new Error(
          `Invalid secret value type for key ${key}. Must be string, number, boolean, or object.`
        );
      }

      // Recursively validate nested objects
      if (typeof value === 'object' && value !== null) {
        this.validateSecretValues(value as SecretValueObject);
      }
    });
  }
}
