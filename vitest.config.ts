import { defineConfig } from 'vitest/config';

// One Vitest project per surface; each config carries only the aliases its
// surface may import. `vitest run --project <name>` runs one alone.
export default defineConfig({
  test: {
    projects: [
      'src/store/vitest.config.ts',
      'src/agent/vitest.config.ts',
      'src/tui/vitest.config.ts',
      'src/cli/vitest.config.ts',
      'e2e-harness/vitest.config.ts',
      'src/__tests__/architecture/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      exclude: ['dist/**'],
    },
  },
});
