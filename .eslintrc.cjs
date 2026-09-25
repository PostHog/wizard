module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
  },
  ignorePatterns: [
    '.eslintrc.js',
    'babel.config.js',
    'build/**',
    'dist/**',
    'esm/**',
    'assets/**',
    'scripts/**',
    'coverage/**',
    // Standalone jest-based package, linted/typechecked in its own context and
    // outside the root tsconfig the parser uses (parserOptions.project).
    'e2e-tests/**',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  overrides: [
    {
      // The agent surface. It takes resolved data in, reports through
      // progress events and asks through an injected answerer, so nothing
      // here may import a UI, the session, detection, the CLI or a program.
      // Only direct static imports are checked. Program types stay importable
      // until B1 moves PROGRAM_BINDINGS to programs.
      files: ['src/agent/**/*.ts'],
      excludedFiles: ['**/__tests__/**'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@utils/wizard-abort',
                importNames: ['wizardAbort'],
                message:
                  'The agent never exits the process: return a failure in RunResult.',
              },
              {
                name: '@shared/utils/wizard-abort',
                importNames: ['wizardAbort'],
                message:
                  'The agent never exits the process: return a failure in RunResult.',
              },
            ],
            patterns: [
              {
                group: [
                  '@ui',
                  '@ui/**',
                  '**/ui',
                  '**/ui/**',
                  '@lib/**',
                  '!@lib/programs/**',
                  '**/lib/**',
                  '!**/lib/programs/**',
                  '**/wizard-session',
                  '**/detection',
                  '**/detection/**',
                  '**/runners',
                  '**/runners/**',
                  '**/commands/**',
                  '@steps',
                  '@steps/**',
                  '**/steps',
                  '**/steps/**',
                  '@frameworks/**',
                  '**/frameworks/**',
                  '@utils/setup-utils',
                  '@shared/utils/setup-utils',
                  '**/setup-utils',
                  '@utils/oauth',
                  '@shared/utils/oauth',
                  '**/utils/oauth',
                ],
                message:
                  'The agent reports through progress events and asks through AgentInteraction; it takes everything else through RunConfig and RunInput.',
              },
              {
                group: ['@lib/programs/**', '**/programs/**'],
                allowTypeImports: true,
                message:
                  'The agent takes program data through RunConfig. Types only, until B1 moves PROGRAM_BINDINGS to programs.',
              },
            ],
          },
        ],
      },
    },
    {
      // Outside the agent, import it through its entry modules only:
      // `@agent` for values, `@agent/types` for types. The architecture test
      // applies the same rule to resolved paths; this gives editor feedback.
      files: ['bin.ts', 'src/**/*.ts', 'src/**/*.tsx'],
      excludedFiles: ['src/agent/**', '**/__tests__/**', '**/__mocks__/**'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@agent/**', '!@agent/types'],
                message:
                  'Import the agent through @agent (values) or @agent/types (types).',
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        '*.test.js',
        '*.test.ts',
        '**/__tests__/**/*.ts',
        '**/__tests__/**/*.js',
        '**/__mocks__/**/*.ts',
      ],
      globals: {
        // vitest test APIs (test.globals: true) ...
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        suite: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        vitest: 'readonly',
        // ... and the ambient mock helper types from types/vitest-global-types.d.ts
        Mock: 'readonly',
        Mocked: 'readonly',
        MockInstance: 'readonly',
        MockedFunction: 'readonly',
        MockedClass: 'readonly',
      },
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
  globals: {
    NodeJS: true,
  },
  rules: {
    'no-console': 'error',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-var-requires': 'off',
    // '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    'no-undef': 'error', // https://github.com/typescript-eslint/typescript-eslint/issues/4580#issuecomment-1047144015
  },
};
