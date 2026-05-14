import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['bin.ts'],
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,

  // Lock environment variables at build time.
  // After build, setting NODE_ENV at runtime has zero effect on the wizard.
  // To add a new build-time constant, add it here AND in src/env.ts.
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    POSTHOG_LLM_GATEWAY_URL: process.env.POSTHOG_LLM_GATEWAY_URL ?? '',
  },

  // Keep npm dependencies external — they're installed at runtime.
  skipNodeModulesBundle: true,

  sourcemap: true,
  clean: true,

  // Path aliases — resolved from tsconfig.json paths automatically.
  // tsdown/rolldown reads the "paths" field in tsconfig.build.json.
});
