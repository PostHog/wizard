// A specifier with a .tsbuild/ or node_modules/ segment, and the `module`
// builtin. esquery regexes can't hold a `/`, so `\x2F` stands in for it.
const PAST_THE_FENCES = String.raw`/(^|\x2F)(node_modules|\.tsbuild)(\x2F|$)/`;
const MODULE_BUILTIN = '/^(node:)?module$/';
// import('...') and typeof import('...') whose specifier matches `pattern`.
const importCallOf = (pattern) =>
  [
    `ImportExpression > Literal.source[value=${pattern}]`,
    `ImportExpression > TemplateLiteral.source > TemplateElement[value.raw=${pattern}]`,
    `TSImportType > TSLiteralType > Literal[value=${pattern}]`,
  ].join(', ');
// vi.importActual('...') and vi.importMock('...') whose path matches `pattern`.
const viImportOf = (pattern) =>
  [
    `CallExpression[callee.object.name='vi'][callee.property.name=/^(importActual|importMock)$/][arguments.0.value=${pattern}]`,
    `CallExpression[callee.object.name='vi'][callee.property.name=/^(importActual|importMock)$/] > TemplateLiteral.arguments:first-child > TemplateElement[value.raw=${pattern}]`,
  ].join(', ');
// The same, plus the import and re-export declarations.
const specifierOf = (pattern) =>
  [
    importCallOf(pattern),
    ...[
      'ImportDeclaration',
      'ExportAllDeclaration',
      'ExportNamedDeclaration',
    ].map((node) => `${node} > Literal.source[value=${pattern}]`),
  ].join(', ');

// no-restricted-imports sees only import and export declarations, so the
// import(), typeof import() and vi.importActual/vi.importMock forms of its two
// bans are here.
const RESTRICTED_SYNTAX = [
  {
    selector: [importCallOf(PAST_THE_FENCES), viImportOf(PAST_THE_FENCES)].join(
      ', ',
    ),
    message:
      'Import a layer through its entry and a package by its name; a .tsbuild/ or node_modules/ path skips the layer fences.',
  },
  {
    selector: importCallOf(MODULE_BUILTIN),
    message: "Import the module; 'module' loaders skip the layer fences.",
  },
];

// TypeScript's project references stop a layer importing a project it does not
// reference, but let it reach any file of one it does, by relative path or deep
// alias. Two more bans close that, in every layer folder (an override per layer
// and depth, as a relative import climbs a fixed number of folders to leave):
// a relative import stays in its layer's folder, and another layer's deep alias
// is out. The alias's own layer, and each program's entry, stay allowed.
const fs = require('fs');
const path = require('path');
const PROGRAMS_DIR = path.join(__dirname, 'src/programs');
const PROGRAM_IDS = fs
  .readdirSync(PROGRAMS_DIR, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      fs.existsSync(path.join(PROGRAMS_DIR, d.name, 'tsconfig.json')),
  )
  .map((d) => d.name);
const LAYERS = [
  'src/shared',
  'src/host',
  'src/agent',
  'src/tools',
  'src/programs',
  'src/headless',
  'src/tui',
  'src/cli',
  'e2e-harness',
  'docs/examples',
  'scripts',
];
const DEEP_ALIASES = {
  'src/agent': String.raw`/^@agent\x2F(?!types$)/`,
  'src/programs': String.raw`/^@programs\x2F(?!(types|${PROGRAM_IDS.join(
    '|',
  )})$)/`,
  'src/tui': String.raw`/^@tui\x2F/`,
};
const MAX_DEPTH = 8;
const layerBans = (layer, depth) => [
  {
    selector: specifierOf(String.raw`/^(\.\.\x2F){${depth + 1},}/`),
    message: `A relative import stays in ${layer}; import another layer through its alias.`,
  },
  {
    // The count above sees only the leading run of ../, so `./..`, a `..` after a name, and a `/./` or `//` segment would climb unseen.
    selector: specifierOf(
      String.raw`/^\.\x2F\.\.|[^.\x2F]\x2F\.\.(\x2F|$)|\x2F\.(\x2F|$)|\x2F\x2F/`,
    ),
    message: 'A relative path climbs only from its start.',
  },
  // Project references are transitive, so the hosts could reach the agent's runtime; they use @agent/types only.
  ...(['src/tui', 'src/headless'].includes(layer)
    ? [
        {
          selector: specifierOf(String.raw`/^@agent$/`),
          message:
            'The hosts reach the agent through @programs; import types from @agent/types.',
        },
      ]
    : []),
  ...Object.entries(DEEP_ALIASES)
    .filter(([owner]) => owner !== layer)
    .map(([, pattern]) => ({
      selector: specifierOf(pattern),
      message: 'Import another layer through its entry alias, not a deep one.',
    })),
];
// A TUI program or tool folder references the TUI core, and references are
// transitive, so it could reach what the core reaches. It keeps its own entry only.
const tuiFolders = (dir) =>
  fs
    .readdirSync(path.join(__dirname, dir), { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        fs.existsSync(path.join(__dirname, dir, d.name, 'tsconfig.json')),
    )
    .map((d) => d.name);
const folderBans = (kind, id) => [
  {
    // A TUI program may use the programs core and its own entry; a tool uses no program.
    selector: specifierOf(
      kind === 'programs'
        ? String.raw`/^@programs\x2F(?!(types|${id})$)/`
        : String.raw`/^@programs($|\x2F)/`,
    ),
    message: `A TUI ${
      kind === 'programs'
        ? "program imports another program's entry"
        : 'tool imports a program'
    }.`,
  },
  {
    // The integration intro lists the tools, so only it may import @tools.
    selector: specifierOf(
      kind === 'programs' && id !== 'posthog-integration'
        ? String.raw`/^@(tools$|host\x2F)/`
        : String.raw`/^@host\x2F/`,
    ),
    message: 'The TUI core owns the host and tools calls.',
  },
];
const tuiFolderOverrides = ['programs', 'tools'].flatMap((kind) =>
  tuiFolders(`src/tui/${kind}`).flatMap((id) =>
    Array.from({ length: MAX_DEPTH - 2 }, (_, depth) => ({
      files: [`src/tui/${kind}/${id}/${'*/'.repeat(depth)}*.{ts,tsx}`],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...RESTRICTED_SYNTAX,
          ...layerBans('src/tui', depth + 2),
          ...folderBans(kind, id),
        ],
      },
    })),
  ),
);
const layerOverrides = LAYERS.flatMap((layer) =>
  Array.from({ length: MAX_DEPTH }, (_, depth) => ({
    files: [`${layer}/${'*/'.repeat(depth)}*.{ts,tsx}`],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX,
        ...layerBans(layer, depth),
      ],
    },
  })),
);

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
    project: ['./tsconfig.eslint.json'],
  },
  ignorePatterns: [
    '.eslintrc.js',
    'babel.config.js',
    'build/**',
    'dist/**',
    'esm/**',
    'assets/**',
    'scripts/**/*.{js,mjs,cjs}',
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
    ...layerOverrides,
    ...tuiFolderOverrides,
    {
      // Scripts get the layer fences only; the rest of the rule set never covered them.
      files: ['scripts/**/*.{ts,tsx}'],
      rules: {
        'no-console': 'off',
        'no-undef': 'off',
        'no-useless-escape': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/restrict-plus-operands': 'off',
      },
    },
    {
      // Single-file layers: no relative import leaves them. bin.ts and main.ts
      // are one layer: bin.ts loads main.ts once its Node check passes.
      files: [
        'bin.ts',
        'main.ts',
        'src/env.ts',
        'tsdown.config.ts',
        'vitest.config.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...RESTRICTED_SYNTAX,
          {
            selector: specifierOf(String.raw`/^\./`),
            message: 'Import by alias; a relative path leaves the layer.',
          },
        ],
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
    'no-restricted-imports': [
      'error',
      {
        // `module` holds runtime loaders (createRequire and kin) that return `any`
        // and load what TypeScript never resolves, so no layer fence sees them.
        paths: [
          {
            name: 'module',
            message:
              "Import the module; 'module' loaders skip the layer fences.",
          },
          {
            name: 'node:module',
            message:
              "Import the module; 'module' loaders skip the layer fences.",
          },
        ],
        // A .tsbuild/ or node_modules/ path resolves past the layer aliases and the TUI-only fence.
        patterns: [
          {
            group: ['.tsbuild'],
            message: "Import the layer through its entry's alias.",
          },
          {
            group: ['node_modules'],
            message: 'Import the package by its name.',
          },
        ],
      },
    ],
    // A bare `require` returns `any` and loads what TypeScript never resolves.
    'no-restricted-globals': [
      'error',
      {
        name: 'require',
        message: 'Import the module; require skips the layer fences.',
      },
    ],
    // A triple-slash path or types reference pulls declarations into a layer past its file list and fences.
    '@typescript-eslint/triple-slash-reference': [
      'error',
      { path: 'never', types: 'never', lib: 'always' },
    ],
    'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX],
  },
};
