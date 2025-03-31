#!/usr/bin/env node
import 'source-map-support/register';
import { App, Tags } from 'aws-cdk-lib';
import { CDKStack } from './cdk-stack';
import * as dotenv from 'dotenv';

export interface EnvConfig {
  CDK_ACCOUNT: string;
  CDK_REGION: string;
  LOG_LEVEL: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  SLACK_WEBHOOK_URL: string;
  APP_VPC_ID: string;
  DESTINATION_EMAIL: string;
  SOURCE_EMAIL: string;
}
dotenv.config();

const app = new App();
const envName: string = app.node.tryGetContext('env');
const namespace: string = app.node.tryGetContext('namespace')
  ? `-${app.node.tryGetContext('namespace')}`
  : '';
const envConfigs: EnvConfig = app.node.tryGetContext(envName);
const slackWebhookUrl = envConfigs.SLACK_WEBHOOK_URL;
const appVpcId = envConfigs.APP_VPC_ID;
const destinationEmail = envConfigs.DESTINATION_EMAIL;
const sourceEmail = envConfigs.SOURCE_EMAIL;

const stackName = `${process.env.CDK_STACK_NAME_PREFIX}-backend-${envName}${namespace}`;

const stack = new CDKStack(app, stackName, {
  env: {
    account: envConfigs.CDK_ACCOUNT,
    region: envConfigs.CDK_REGION,
  },
  envName,
  namespace,
  envConfigs,
  slackWebhookUrl,
  appVpcId,
  destinationEmail,
  sourceEmail,
});

Tags.of(stack).add('Environment', envName);
Tags.of(stack).add('Owner', 'PayQAM');
Tags.of(stack).add('SupportGroup', 'DevOps');
Tags.of(stack).add('Name', stackName);
Tags.of(stack).add('Client', 'Shared');
Tags.of(stack).add('CreatedBy', 'QrioMatrix');
Tags.of(stack).add('Developer', 'Nadeesha Dileen');
