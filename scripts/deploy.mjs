#!/usr/bin/env zx
await $`npx cdk deploy -c env=${process.env.ENV} -c namespace=${process.env.NAMESPACE} --require-approval never --outputs-file ./cdk-outputs.json`;
