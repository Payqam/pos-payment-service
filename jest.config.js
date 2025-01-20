// es-lint
// eslint-disable-next-line
module.exports = {
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!<rootDir>/node_modules/'],
  testEnvironment: 'node',
  roots: ['.'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  setupFiles: ['<rootDir>/.jest/setEnvVars.js'],
};
