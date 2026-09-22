import * as path from 'path';
import { defineConfig, type Plugin } from 'vitest/config';

const r = (...p: string[]) => path.resolve(__dirname, ...p);

/**
 * The source uses NodeNext-style relative imports that carry a `.js` extension
 * (e.g. `import { x } from './foo.js'`) while the files on disk are `.ts`/`.tsx`.
 * Vite does not strip the extension on its own, so this plugin retries a failed
 * `.js` resolution against the matching TypeScript source. It replaces jest's
 * `"^(\\.{1,2}/.*)\\.js$": "$1"` moduleNameMapper entry.
 */
function resolveTsForJs(): Plugin {
  return {
    name: 'resolve-ts-for-js',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!id.endsWith('.js')) return null;
      for (const ext of ['.ts', '.tsx'] as const) {
        const candidate = `${id.slice(0, -3)}${ext}`;
        const resolved = await this.resolve(candidate, importer, {
          ...options,
          skipSelf: true,
        });
        if (resolved) return resolved;
      }
      return null;
    },
  };
}

// Per-surface Vitest projects keyed by today's directories. Each project runs
// alone with `vitest run --project <name>`; `vitest run` runs them all.
const TESTS = '__tests__/**/*.{js,jsx,ts,tsx}';
const AGENT_TESTS = [`src/agent/**/${TESTS}`];
const TUI_TESTS = [`src/ui/tui/**/${TESTS}`];
const CLI_TESTS = [
  `src/commands/**/${TESTS}`,
  `src/lib/runners/${TESTS}`,
  'src/__tests__/*cli*.test.ts',
  'src/__tests__/wizard.test.ts',
  'src/__tests__/headless-scope.test.ts',
];
const HARNESS_TESTS = [
  `e2e-harness/${TESTS}`,
  'e2e-harness/**/*.{test,spec}.{js,jsx,ts,tsx}',
];
const ARCH_TESTS = ['src/__tests__/architecture/**/*.{ts,tsx}'];
const EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/e2e-tests/**',
  '**/*.no-jest.*',
  '**/*.d.ts',
];

const project = (name: string, include: string[], exclude: string[] = []) => ({
  extends: true as const,
  test: { name, include, exclude: [...EXCLUDE, ...exclude] },
});

export default defineConfig({
  plugins: [resolveTsForJs()],
  // The source targets the React 19 automatic JSX runtime (tsconfig
  // `"jsx": "react-jsx"`); mirror that here so the TUI `.tsx` tests transform.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      // Module mocks — parity with jest's moduleNameMapper. Every import of
      // these resolves to the hand-written manual mock; a per-test `vi.mock(...)`
      // factory still takes precedence within that test file.
      {
        find: /^@anthropic-ai\/claude-agent-sdk$/,
        replacement: r('__mocks__/@anthropic-ai/claude-agent-sdk.ts'),
      },
      {
        find: /^@posthog\/warlock$/,
        replacement: r('__mocks__/@posthog/warlock.ts'),
      },
      { find: /^ink$/, replacement: r('__mocks__/ink.ts') },
      { find: /^@shared\/(.*)$/, replacement: `${r('src/shared')}/$1` },
      { find: /^@agent$/, replacement: r('src/agent/index.ts') },
      { find: /^@agent\/types$/, replacement: r('src/agent/types.ts') },
      { find: /^@agent\/(.*)$/, replacement: `${r('src/agent')}/$1` },
      // Path aliases — mirror tsconfig `paths`.
      { find: /^@env$/, replacement: r('src/env.ts') },
      { find: /^@lib\/(.*)$/, replacement: `${r('src/lib')}/$1` },
      { find: /^@e2e-harness\/(.*)$/, replacement: `${r('e2e-harness')}/$1` },
      { find: /^@utils\/(.*)$/, replacement: `${r('src/shared/utils')}/$1` },
      { find: /^@ui$/, replacement: r('src/ui/index.ts') },
      { find: /^@ui\/(.*)$/, replacement: `${r('src/ui')}/$1` },
      { find: /^@steps$/, replacement: r('src/steps/index.ts') },
      { find: /^@steps\/(.*)$/, replacement: `${r('src/steps')}/$1` },
      { find: /^@frameworks\/(.*)$/, replacement: `${r('src/frameworks')}/$1` },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    projects: [
      project('agent', AGENT_TESTS),
      project('tui', TUI_TESTS),
      project('cli', CLI_TESTS),
      project('harness', HARNESS_TESTS),
      project('architecture', ARCH_TESTS),
      project(
        'legacy',
        // The second glob keeps the pre-split behavior: a test file outside
        // a __tests__ directory still runs, here, rather than nowhere.
        [`src/**/${TESTS}`, 'src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
        [...AGENT_TESTS, ...TUI_TESTS, ...CLI_TESTS, ...ARCH_TESTS],
      ),
    ],
    coverage: {
      provider: 'v8',
      exclude: ['dist/**'],
    },
  },
});
