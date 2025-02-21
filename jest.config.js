// es-lint
// eslint-disable-next-line
module.exports = {
  preset: 'ts-jest',
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!<rootDir>/node_modules/'],
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
