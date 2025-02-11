import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

export interface KMSKeyConfig {
  keyName: string;
  description: string;
  accountId: string;
  stage: string;
  serviceName: string;
  externalRoleArns: string[];
  enableKeyRotation?: boolean;
  enabled?: boolean;
  rotationDays?: number;
}

export interface KeyPolicyStatementConfig {
  sid: string;
  actions: string[];
  principals: string[];
  resources?: string[];
}

export class KMSHelper {
  private static createKeyPolicyStatement(config: KeyPolicyStatementConfig): iam.PolicyStatement {
    return new iam.PolicyStatement({
      sid: config.sid,
      effect: iam.Effect.ALLOW,
      actions: config.actions,
      principals: config.principals.map(principal => new iam.ArnPrincipal(principal)),
      resources: config.resources || ['*'],
    });
  }

  private static getDefaultPolicyStatements(accountId: string, externalRoleArns: string[]): iam.PolicyStatement[] {
    const statements: iam.PolicyStatement[] = [];

    // Add root account permissions
    statements.push(
      KMSHelper.createKeyPolicyStatement({
        sid: 'Enable IAM User Permissions',
        actions: ['kms:*'],
        principals: [`arn:aws:iam::${accountId}:root`],
      })
    );

    // Add external role permissions
    statements.push(
      KMSHelper.createKeyPolicyStatement({
        sid: 'Allow External Account Get Lambda Access',
        actions: ['kms:Decrypt'],
        principals: externalRoleArns,
      })
    );

    return statements;
  }

  public static createKey(
    scope: Construct,
    config: KMSKeyConfig
  ): { key: kms.Key; alias: kms.Alias } {
    // Create the KMS key
    const key = new kms.Key(scope, `${config.keyName}Key`, {
      description: config.description,
      enabled: config.enabled ?? true,
      enableKeyRotation: config.enableKeyRotation ?? true,
      keySpec: kms.KeySpec.SYMMETRIC_DEFAULT,
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      rotationPeriod: Duration.days(config.rotationDays ?? 365),
    });

    // Add the policy statements
    const statements = KMSHelper.getDefaultPolicyStatements(config.accountId, config.externalRoleArns);
    statements.forEach(statement => key.addToResourcePolicy(statement));

    // Create the alias
    const alias = new kms.Alias(scope, `${config.keyName}Alias`, {
      aliasName: `alias/${config.stage}-${config.serviceName}-transport`,
      targetKey: key,
    });

    return { key, alias };
  }

  /**
   * Adds a custom policy statement to an existing KMS key
   */
  public static addKeyPolicyStatement(
    key: kms.Key,
    statementConfig: KeyPolicyStatementConfig
  ): void {
    const statement = KMSHelper.createKeyPolicyStatement(statementConfig);
    key.addToResourcePolicy(statement);
  }
} 