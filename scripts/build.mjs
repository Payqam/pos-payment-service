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
  `../configurations/${env}.config.json`
);

await $`npm run build`;
