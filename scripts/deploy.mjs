#!/usr/bin/env zx
await $`npx cdk@2.69.0 deploy -c env=${process.env.ENV} -c namespace=${process.env.NAMESPACE} --require-approval never --outputs-file ./cdk-outputs.json`;
