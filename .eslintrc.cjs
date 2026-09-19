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
    // The whole-tree config, not the composite surface projects: those resolve
    // cross-surface imports through built declarations, so lint would see
    // `any` until `tsc -b` has run. Boundaries are enforced by tsc -b and the
    // architecture suite, not by lint's type information.
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
    '**/coverage/**',
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
    // Surface boundaries. The matrix and public entries live in
    // src/__tests__/architecture/import-boundaries.test.ts; these mirror it
    // for editor feedback. Tests may reach into internals.
    {
      files: ['src/store/**/*.ts', 'src/store/**/*.tsx'],
      excludedFiles: ['**/__tests__/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['ink', 'react', '@inkjs/ui', 'ink-testing-library'],
            patterns: [
              '@agent',
              '@agent/*',
              '@tui',
              '@tui/*',
              '@cli/*',
              'react/*',
            ],
          },
        ],
      },
    },
    {
      files: ['src/agent/**/*.ts', 'src/agent/**/*.tsx'],
      excludedFiles: ['**/__tests__/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['ink', 'react', '@inkjs/ui', 'ink-testing-library'],
            patterns: [
              '@tui',
              '@tui/*',
              '@cli/*',
              'react/*',
              '@store/*',
              '!@store/types',
              '!@store/programs',
            ],
          },
        ],
      },
    },
    {
      files: ['src/tui/**/*.ts', 'src/tui/**/*.tsx'],
      excludedFiles: ['**/__tests__/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              '@agent',
              '@agent/*',
              '@cli/*',
              '@store/*',
              '!@store/types',
              '!@store/programs',
            ],
          },
        ],
      },
    },
    {
      files: ['src/tui/console/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['ink', 'react', '@inkjs/ui', 'ink-testing-library'],
            patterns: [
              '@agent',
              '@agent/*',
              '@cli/*',
              'react/*',
              '@store/*',
              '!@store/types',
              '!@store/programs',
            ],
          },
        ],
      },
    },
    {
      files: ['bin.ts', 'src/cli/**/*.ts', 'src/cli/**/*.tsx'],
      excludedFiles: ['**/__tests__/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['ink', 'react', '@inkjs/ui', 'ink-testing-library'],
            patterns: [
              'react/*',
              '@store/*',
              '!@store/types',
              '!@store/programs',
              '@agent/*',
              '!@agent/types',
              '@tui/*',
              '!@tui/types',
              '!@tui/console',
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
