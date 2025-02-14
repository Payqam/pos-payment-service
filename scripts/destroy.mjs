#!/usr/bin/env zx
import path from 'path';

const env = process.env.ENV;
const ENV_SECRETS = `${process.env.ENV_SECRETS}`;
const SECRETS = ENV_SECRETS.split(',');
SECRETS.forEach((secret) => {
  const [key, value] = secret.split(':::');
  if (key && value) {
    process.env[key.trim()] = value.trim();
  }
});

// Read the environment variable values from the JSON file
const envVarsPath = path.join(
  __dirname,
  `../configurations/workflow/${env}.config.json`
);

// Set up env variables
const envVarsData = require(envVarsPath);
for (const key in envVarsData) {
  if (envVarsData.hasOwnProperty(key)) {
    const value = envVarsData[key];
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  }
}

// await $`npx cdk destroy -c env=${process.env.ENV} -c namespace=${process.env.NAMESPACE} --force`;
