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
  // The wizard sources use ESM-style relative `.js` specifiers and the
  // surface aliases from ../tsconfig.build.json; jest resolves neither.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@env$': '<rootDir>/../src/env.ts',
    '^@store$': '<rootDir>/../src/store/index.ts',
    '^@store/types$': '<rootDir>/../src/store/types.ts',
    '^@store/programs$': '<rootDir>/../src/store/programs/index.ts',
    '^@store/(.*)$': '<rootDir>/../src/store/$1',
    '^@agent$': '<rootDir>/../src/agent/index.ts',
    '^@agent/types$': '<rootDir>/../src/agent/types.ts',
    '^@agent/(.*)$': '<rootDir>/../src/agent/$1',
    '^@tui$': '<rootDir>/../src/tui/index.ts',
    '^@tui/types$': '<rootDir>/../src/tui/types.ts',
    '^@tui/console$': '<rootDir>/../src/tui/console/index.ts',
    '^@tui/(.*)$': '<rootDir>/../src/tui/$1',
    '^@cli/(.*)$': '<rootDir>/../src/cli/$1',
  },
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/mocks/setup.ts'],
  globalSetup: '<rootDir>/global-setup.ts',
  globalTeardown: '<rootDir>/global-teardown.ts',
};

export default config;
