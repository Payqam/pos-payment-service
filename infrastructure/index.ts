#!/usr/bin/env node
import "source-map-support/register";
import { App, Tags } from "aws-cdk-lib";
import { CDKStack } from "./cdk-stack";

export interface EnvConfig {
  CDK_ACCOUNT: string;
  CDK_REGION: string;
  LOG_LEVEL: "DEBUG" | "INFO" | "WARN" | "ERROR";
}

const app = new App();
const envName: string = app.node.tryGetContext("env");
const namespace: string = app.node.tryGetContext("namespace")
  ? `-${app.node.tryGetContext("namespace")}`
  : "";
const envConfigs: EnvConfig = app.node.tryGetContext(envName);

const stackName = `${process.env.CDK_STACK_NAME_PREFIX}-backend-${envName}${namespace}`;

const stack = new CDKStack(app, stackName, {
  envName,
  namespace,
  envConfigs,
});

Tags.of(stack).add("Environment", envName);
Tags.of(stack).add("Owner", "PayQAM");
Tags.of(stack).add("SupportGroup", "IT");
Tags.of(stack).add("Name", stackName);
Tags.of(stack).add("Client", "Shared");
