import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface SecretConfig {
  secretName: string;
  description?: string;
  secretValues: Record<string, string>; // Key-value pairs for the secret
}

export class SecretsManagerHelper {
  public static createSecret(
    scope: Construct,
    config: SecretConfig
  ): secretsmanager.Secret {
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
}
