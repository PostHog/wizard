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

// Per-surface Vitest projects. Each runs alone with `vitest run --project
// <name>`; `vitest run` runs them all.
const TESTS = '__tests__/**/*.{js,jsx,ts,tsx}';
const AGENT_TESTS = [`src/agent/**/${TESTS}`];
const TUI_TESTS = [`src/tui/**/${TESTS}`];
const CLI_TESTS = [`src/cli/**/${TESTS}`];
const STORE_TESTS = [`src/store/**/${TESTS}`];
const HARNESS_TESTS = [`e2e-harness/${TESTS}`];
const ARCH_TESTS = ['src/__tests__/architecture/**/*.{ts,tsx}'];
const EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/e2e-tests/**',
  '**/*.no-jest.*',
  '**/*.d.ts',
];

/** Only the tui renders; everywhere else an Ink import is a boundary breach. */
const INK_MOCK = { tui: 'ink.ts', harness: 'ink.ts' } as Record<string, string>;

const project = (name: string, include: string[], exclude: string[] = []) => ({
  extends: true as const,
  resolve: {
    alias: [
      {
        find: /^ink$/,
        replacement: r(`__mocks__/${INK_MOCK[name] ?? 'forbidden-ink.ts'}`),
      },
    ],
  },
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
      // Path aliases — mirror tsconfig `paths`.
      { find: /^@env$/, replacement: r('src/env.ts') },
      { find: /^@e2e-harness\/(.*)$/, replacement: `${r('e2e-harness')}/$1` },
      { find: /^@store$/, replacement: r('src/store/index.ts') },
      {
        find: /^@store\/programs$/,
        replacement: r('src/store/programs/index.ts'),
      },
      { find: /^@store\/(.*)$/, replacement: `${r('src/store')}/$1` },
      { find: /^@agent$/, replacement: r('src/agent/index.ts') },
      { find: /^@agent\/(.*)$/, replacement: `${r('src/agent')}/$1` },
      { find: /^@tui$/, replacement: r('src/tui/index.ts') },
      { find: /^@tui\/console$/, replacement: r('src/tui/console/index.ts') },
      { find: /^@tui\/(.*)$/, replacement: `${r('src/tui')}/$1` },
      { find: /^@cli\/(.*)$/, replacement: `${r('src/cli')}/$1` },
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
      project('store', STORE_TESTS),
    ],
    coverage: {
      provider: 'v8',
      exclude: ['dist/**'],
    },
  },
});
