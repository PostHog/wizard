import { config as dotenvConfig } from 'dotenv';
import type { Config as JestConfig } from 'jest';

dotenvConfig({
  path: '.env',
});

const config: JestConfig = {
  collectCoverage: false,
  testTimeout: process.env.RECORD_FIXTURES === 'true' ? 240 * 1000 : 10 * 1000,
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '!**/test-applications/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/mocks/setup.ts'],
  globalSetup: '<rootDir>/global-setup.ts',
  globalTeardown: '<rootDir>/global-teardown.ts',
};

export default config;
