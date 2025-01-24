#!/usr/bin/env zx
await $`npx cdk destroy -c env=${process.env.ENV} -c namespace=${process.env.NAMESPACE} --force`;
