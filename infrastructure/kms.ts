import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * Configuration for a KMS key
 */
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
  namespace: string;
  iamUserArn?: string;
  region: string;
}

/**
 * Helper class to create and manage KMS keys
 */
export class KMSHelper {
  private static getDefaultPolicyStatements(
    accountId: string,
    externalRoleArns: string[],
    iamUserArn: string,
    region: string
  ): iam.PolicyStatement[] {
    const statements: iam.PolicyStatement[] = [];

    /**
     * Add external role permissions
     */
    if (externalRoleArns && externalRoleArns.length > 0) {
      statements.push(
        new iam.PolicyStatement({
          sid: 'AllowExternalAccountDecryptAccess',
          effect: iam.Effect.ALLOW,
          actions: ['kms:Encrypt'],
          principals: externalRoleArns.map((arn) => new iam.ArnPrincipal(arn)),
          resources: [`arn:aws:kms:${region}:${accountId}:key/*`],
        })
      );
    }
    if (iamUserArn) {
      statements.push(
        new iam.PolicyStatement({
          sid: 'AllowIAMUserEncrypt',
          effect: iam.Effect.ALLOW,
          actions: ['kms:Encrypt'],
          principals: [new iam.ArnPrincipal(iamUserArn)],
          resources: [`arn:aws:kms:${region}:${accountId}:key/*`],
        })
      );
    }

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
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const statements = KMSHelper.getDefaultPolicyStatements(
      config.accountId,
      config.externalRoleArns,
      config.iamUserArn as string,
      config.region
    );
    statements.forEach((statement) => key.addToResourcePolicy(statement));

    const alias = new kms.Alias(scope, `${config.keyName}Alias`, {
      aliasName: `alias/PAYQAM-${config.serviceName}-${config.stage}`,
      targetKey: key,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    return { key, alias };
  }

  /**
   * Grants decryption permissions to a given Lambda function
   */
  public static grantDecryptPermission(
    key: kms.IKey | kms.Key,
    lambdaFunction: IFunction,
    region: string,
    accountId: string
  ) {
    if (lambdaFunction.role) {
      key.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: 'AllowLambdaDecrypt',
          effect: iam.Effect.ALLOW,
          actions: ['kms:Decrypt'],
          principals: [lambdaFunction.role],
          resources: [`arn:aws:kms:${region}:${accountId}:key/*`],
        })
      );
    } else {
      console.warn(
        `Lambda function ${lambdaFunction.functionName} does not have a role assigned.`
      );
    }
  }
}
