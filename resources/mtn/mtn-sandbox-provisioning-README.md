# MTN Sandbox User Provisioning Script

This script automates the creation of MTN MoMo API users and API keys for both collection and disbursement services in the sandbox environment. It follows the MTN Mobile Money API specifications and generates credentials in the format required by the PayQAM system.

## Prerequisites

- Node.js 14+
- TypeScript and ts-node (`npm install -g typescript ts-node`)
- Required npm packages (will be installed if missing):
  - axios
  - uuid
  - yargs

## Installation

1. Make sure you have the required subscription keys from the MTN Developer Portal:
   - Collection subscription key
   - Disbursement subscription key

2. Install the required dependencies:

```bash
npm install axios uuid yargs
```

## Usage

Run the script with your subscription keys:

```bash
ts-node mtn-sandbox-provisioning.ts --collection-key YOUR_COLLECTION_KEY --disbursement-key YOUR_DISBURSEMENT_KEY --callback-url YOUR_CALLBACK_URL
```

Or using the short form:

```bash
ts-node mtn-sandbox-provisioning.ts -c YOUR_COLLECTION_KEY -d YOUR_DISBURSEMENT_KEY -u YOUR_CALLBACK_URL
```

The `--callback-url` parameter is optional. If not provided, it defaults to `https://webhook.site/callback`.

## Output

The script will:

1. Generate UUIDs for both collection and disbursement API users
2. Create API users in the MTN sandbox with the specified callback URL
3. Generate API keys for both users
4. Save the credentials to a JSON file in the current directory
5. Display the credentials in the format required for AWS Secrets Manager

## Integrating with PayQAM

The generated credentials are in the format expected by the PayQAM system. You can:

1. Copy the JSON output to create a secret in AWS Secrets Manager
2. Update the `MTN_API_SECRET` environment variable in your Lambda functions to point to the new secret

## Security Considerations

- The generated credentials should be stored securely in AWS Secrets Manager
- Use a valid callback URL that can receive webhook notifications from MTN
- Set the `webhookSecret` field in the generated JSON before using in production

## Troubleshooting

- If you encounter rate limiting issues, wait a few minutes before retrying
- Verify that your subscription keys are valid and active
- Check the MTN Developer Portal for any service disruptions
- Ensure your callback URL is accessible from the internet

## References

- [MTN MoMo API Documentation](https://momodeveloper.mtn.com/docs)
- [Sandbox Provisioning API](https://momodeveloper.mtn.com/API-collections#api=sandbox-provisioning-api)
