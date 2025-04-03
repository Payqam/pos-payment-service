#!/usr/bin/env ts-node
/**
 * MTN Sandbox User Provisioning Script
 *
 * This script automates the creation of MTN sandbox API users and keys for both
 * collection and disbursement services. It follows the MTN MoMo API specifications
 * for the sandbox environment.
 *
 * Usage:
 *   ts-node mtn-sandbox-provisioning.ts --collection-key YOUR_COLLECTION_KEY --disbursement-key YOUR_DISBURSEMENT_KEY --callback-url YOUR_CALLBACK_URL
 *
 * Requirements:
 *   - Node.js 14+
 *   - ts-node (npm install -g ts-node typescript)
 *   - axios, uuid, yargs (will be installed if missing)
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import * as yargs from 'yargs';

// Base URL for MTN Sandbox API
const BASE_URL = 'https://sandbox.momodeveloper.mtn.com';

// Define service types
enum ServiceType {
  COLLECTION = 'collection',
  DISBURSEMENT = 'disbursement',
}

// Interface for API credentials
interface ApiCredentials {
  apiUser: string;
  apiKey: string;
  subscriptionKey: string;
}

// Interface for provisioning results
interface ProvisioningResult {
  collection: ApiCredentials;
  disbursement: ApiCredentials;
}

/**
 * Creates an API user in the MTN sandbox
 *
 * @param subscriptionKey - The subscription key for the service
 * @param serviceType - The type of service (collection or disbursement)
 * @param callbackUrl - The callback URL for the API user
 * @returns The UUID of the created API user
 */
async function createApiUser(
  subscriptionKey: string,
  serviceType: ServiceType,
  callbackUrl: string
): Promise<string> {
  console.log(`Creating API user for ${serviceType} service...`);

  // Generate a UUID for the API user
  const apiUserId = uuidv4();

  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const response = await axios({
      method: 'POST',
      url: `${BASE_URL}/v1_0/apiuser`,
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'X-Reference-Id': apiUserId,
      },
      data: {
        providerCallbackHost: callbackUrl,
      },
    });

    console.log(`✅ API user created successfully with ID: ${apiUserId}`);
    return apiUserId;
  } catch (error: any) {
    console.error(
      `❌ Failed to create API user for ${serviceType}:`,
      error.response?.data || error.message
    );
    throw new Error(`Failed to create API user for ${serviceType}`);
  }
}

/**
 * Creates an API key for the specified API user
 *
 * @param apiUserId - The UUID of the API user
 * @param subscriptionKey - The subscription key for the service
 * @param serviceType - The type of service (collection or disbursement)
 * @returns The generated API key
 */
async function createApiKey(
  apiUserId: string,
  subscriptionKey: string,
  serviceType: ServiceType
): Promise<string> {
  console.log(`Creating API key for ${serviceType} service...`);

  try {
    const response = await axios({
      method: 'POST',
      url: `${BASE_URL}/v1_0/apiuser/${apiUserId}/apikey`,
      headers: {
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
    });

    console.log(`✅ API key created successfully for ${serviceType}`);
    return response.data.apiKey;
  } catch (error: any) {
    console.error(
      `❌ Failed to create API key for ${serviceType}:`,
      error.response?.data || error.message
    );
    throw new Error(`Failed to create API key for ${serviceType}`);
  }
}

/**
 * Provisions a complete service (creates API user and API key)
 *
 * @param subscriptionKey - The subscription key for the service
 * @param serviceType - The type of service (collection or disbursement)
 * @param callbackUrl - The callback URL for the API user
 * @returns Object containing the API user ID and API key
 */
async function provisionService(
  subscriptionKey: string,
  serviceType: ServiceType,
  callbackUrl: string
): Promise<ApiCredentials> {
  console.log(`\n🔄 Provisioning ${serviceType} service...`);

  try {
    // Create API user
    const apiUserId = await createApiUser(
      subscriptionKey,
      serviceType,
      callbackUrl
    );

    // Create API key for the user
    const apiKey = await createApiKey(apiUserId, subscriptionKey, serviceType);

    return {
      apiUser: apiUserId,
      apiKey: apiKey,
      subscriptionKey: subscriptionKey,
    };
  } catch (error) {
    console.error(`❌ Failed to provision ${serviceType} service:`, error);
    throw error;
  }
}

/**
 * Saves the provisioning results to a JSON file
 *
 * @param results - The provisioning results to save
 */
function saveResults(results: ProvisioningResult): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `mtn-credentials-${timestamp}.json`;
  const filePath = path.join(process.cwd(), fileName);

  // Format the results in the structure expected by the application
  const formattedResults = {
    collection: results.collection,
    disbursement: results.disbursement,
    targetEnvironment: 'sandbox',
    webhookSecret: '', // This would need to be set separately
  };

  fs.writeFileSync(filePath, JSON.stringify(formattedResults, null, 2));
  console.log(`\n💾 Credentials saved to ${fileName}`);

  // Also output in AWS Secrets Manager format
  console.log('\n📋 AWS Secrets Manager format:');
  console.log(JSON.stringify(formattedResults, null, 2));
}

/**
 * Main function to run the provisioning process
 */
async function main() {
  // Parse command line arguments
  const argv = yargs
    .option('collection-key', {
      alias: 'c',
      description: 'Collection subscription key',
      type: 'string',
      demandOption: true,
    })
    .option('disbursement-key', {
      alias: 'd',
      description: 'Disbursement subscription key',
      type: 'string',
      demandOption: true,
    })
    .option('callback-url', {
      alias: 'u',
      description: 'Callback URL for the API user',
      type: 'string',
      default: 'https://webhook.site/callback',
    })
    .help()
    .alias('help', 'h').argv as any;

  console.log('🚀 Starting MTN Sandbox User Provisioning...');
  console.log(`📌 Using callback URL: ${argv.callbackUrl}`);

  try {
    // Provision collection service
    const collectionCredentials = await provisionService(
      argv.collectionKey,
      ServiceType.COLLECTION,
      argv.callbackUrl
    );

    // Provision disbursement service
    const disbursementCredentials = await provisionService(
      argv.disbursementKey,
      ServiceType.DISBURSEMENT,
      argv.callbackUrl
    );

    // Combine results
    const results: ProvisioningResult = {
      collection: collectionCredentials,
      disbursement: disbursementCredentials,
    };

    // Save results to file
    saveResults(results);

    // Display final results
    console.log('\n✅ Provisioning completed successfully!');
    console.log('\n📊 Summary:');
    console.log('Collection API User:', collectionCredentials.apiUser);
    console.log('Collection API Key:', collectionCredentials.apiKey);
    console.log('Disbursement API User:', disbursementCredentials.apiUser);
    console.log('Disbursement API Key:', disbursementCredentials.apiKey);
  } catch (error) {
    console.error('\n❌ Provisioning failed:', error);
    process.exit(1);
  }
}

// Run the main function
main();
