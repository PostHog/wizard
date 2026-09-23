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
  // Jest does not read TypeScript's path aliases. Keep the e2e runner aligned
  // with tsconfig.build.json so source imports resolve after the directory split.
  moduleNameMapper: {
    '^@env$': '<rootDir>/../src/env.ts',
    '^@shared/(.*)$': '<rootDir>/../src/shared/$1',
    '^@agent$': '<rootDir>/../src/agent/index.ts',
    '^@agent/(.*)$': '<rootDir>/../src/agent/$1',
    '^@programs$': '<rootDir>/../src/programs/index.ts',
    '^@programs/(.*)$': '<rootDir>/../src/programs/$1',
    '^@lib/(.*)$': '<rootDir>/../src/lib/$1',
    '^@e2e-harness/(.*)$': '<rootDir>/../e2e-harness/$1',
    '^@utils/(.*)$': '<rootDir>/../src/shared/utils/$1',
    '^@ui$': '<rootDir>/../src/ui/index.ts',
    '^@ui/(.*)$': '<rootDir>/../src/ui/$1',
    '^@steps$': '<rootDir>/../src/steps/index.ts',
    '^@steps/(.*)$': '<rootDir>/../src/steps/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/mocks/setup.ts'],
  globalSetup: '<rootDir>/global-setup.ts',
  globalTeardown: '<rootDir>/global-teardown.ts',
};

export default config;
