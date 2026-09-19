import * as path from 'path';
import type { Plugin, UserConfig } from 'vitest/config';

const r = (...p: string[]) => path.resolve(__dirname, ...p);

export type Surface = 'env' | 'store' | 'agent' | 'tui' | 'cli' | 'harness';

/**
 * The source uses NodeNext-style relative imports that carry a `.js` extension
 * while the files on disk are `.ts`/`.tsx`. Vite does not strip the extension
 * on its own, so this plugin retries a failed `.js` resolution against the
 * matching TypeScript source.
 */
export function resolveTsForJs(): Plugin {
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

/** Aliases per surface. A project only receives the surfaces it may import. */
const SURFACE_ALIASES: Record<
  Surface,
  ReadonlyArray<{ find: RegExp; replacement: string }>
> = {
  env: [{ find: /^@env$/, replacement: r('src/env.ts') }],
  store: [
    { find: /^@store$/, replacement: r('src/store/index.ts') },
    {
      find: /^@store\/programs$/,
      replacement: r('src/store/programs/index.ts'),
    },
    { find: /^@store\/(.*)$/, replacement: `${r('src/store')}/$1` },
  ],
  agent: [
    { find: /^@agent$/, replacement: r('src/agent/index.ts') },
    { find: /^@agent\/(.*)$/, replacement: `${r('src/agent')}/$1` },
  ],
  tui: [
    { find: /^@tui$/, replacement: r('src/tui/index.ts') },
    { find: /^@tui\/console$/, replacement: r('src/tui/console/index.ts') },
    { find: /^@tui\/(.*)$/, replacement: `${r('src/tui')}/$1` },
  ],
  cli: [{ find: /^@cli\/(.*)$/, replacement: `${r('src/cli')}/$1` }],
  harness: [
    { find: /^@e2e-harness\/(.*)$/, replacement: `${r('e2e-harness')}/$1` },
  ],
};

export interface SurfaceProjectOptions {
  name: string;
  /** Surfaces whose aliases resolve. Any other surface fails at import time. */
  imports: readonly Surface[];
  /** Real Ink stays behind the tui; elsewhere an Ink import throws at load. */
  ink: 'mock' | 'forbidden';
  /** Test globs, relative to the project directory. */
  include?: string[];
}

/** One Vitest project per surface, mirroring the import matrix. */
export function surfaceProject(o: SurfaceProjectOptions): UserConfig {
  return {
    plugins: [resolveTsForJs()],
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        {
          find: /^@anthropic-ai\/claude-agent-sdk$/,
          replacement: r('__mocks__/@anthropic-ai/claude-agent-sdk.ts'),
        },
        {
          find: /^@posthog\/warlock$/,
          replacement: r('__mocks__/@posthog/warlock.ts'),
        },
        {
          find: /^ink$/,
          replacement: r(
            o.ink === 'mock'
              ? '__mocks__/ink.ts'
              : '__mocks__/forbidden-ink.ts',
          ),
        },
        ...o.imports.flatMap((s) => SURFACE_ALIASES[s]),
      ],
    },
    test: {
      name: o.name,
      globals: true,
      environment: 'node',
      include: o.include ?? ['**/__tests__/**/*.{js,jsx,ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.no-jest.*',
        '**/*.d.ts',
      ],
    },
  };
}
