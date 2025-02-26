import { defineConfig } from 'cypress';
import console from 'node:console';

export default defineConfig({
  reporter: 'cypress-multi-reporters',
  reporterOptions: {
    reporterEnabled: 'cypress-mochawesome-reporter, mocha-junit-reporter',
    cypressMochawesomeReporterReporterOptions: {
      reportDir: 'reports',
      reportFilename: '[name]',
      overwrite: true,
      html: false,
      json: true,
    },
    mochaJunitReporterReporterOptions: {
      mochaFile: 'reports/results-[hash].xml',
      toConsole: true,
      experimentalMemoryManagement: true,
      numTestsKeptInMemory: 0,
    },
  },
  e2e: {
    setupNodeEvents(on, config) {
      on('task', {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
      return config; // Return the config object
    },
    screenshotOnRunFailure: false,
    specPattern: '**/**/*.cy.{js,jsx,ts,tsx}',
    video: false,
  },
  env: {
    stripeApiKey: process.env.cypressstripeApiKey,
    paymentServiceEndpoint: process.env.cypresspaymentServiceEndpoint,
    paymentApiUrl: process.env.cypresspaymentApiUrl,
    xApiKey: process.env.cypressxApiKey,
    paymentMethodId: process.env.cypresspaymentMethodId,
    transactionId: process.env.cypresstransactionId,
  },
});
