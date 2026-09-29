import { defineConfig } from 'tsdown';

// TODO(publish-library): to publish runProgram (with SessionStore) and runAgent,
// set this to true and add "./programs" and "./agent" to package.json "exports",
// each pointing at dist/<name>.js with its dist/<name>.d.ts. The two entries import
// no TUI, CLI or Ink code, and `pnpm typecheck` keeps it that way.
const PUBLISH_LIBRARY = false;
const LIBRARY_ENTRIES = {
  programs: 'src/programs/index.ts',
  agent: 'src/agent/index.ts',
};

export default defineConfig({
  entry: PUBLISH_LIBRARY ? { bin: 'bin.ts', ...LIBRARY_ENTRIES } : ['bin.ts'],
  ...(PUBLISH_LIBRARY ? { dts: true } : {}),
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,

  // Lock environment variables at build time.
  // After build, setting NODE_ENV at runtime has zero effect on the wizard.
  // To add a new build-time constant, add it here AND in src/env.ts.
  //
  // Published builds inline `production` (which disables `--ci`; see src/env.ts).
  // CI/test harnesses that need `--ci` build with WIZARD_BUILD_NODE_ENV=ci via
  // the `build:ci` script: `'ci'` flips only IS_PRODUCTION_BUILD to false, while
  // IS_DEV and the `NODE_ENV === 'test'` mock paths stay exactly as in prod.
  env: {
    NODE_ENV: process.env.WIZARD_BUILD_NODE_ENV || 'production',
  },

  // Keep npm dependencies external — they're installed at runtime.
  skipNodeModulesBundle: true,

  sourcemap: true,
  clean: true,

  // One config for every file: the per-layer tsconfigs map only their own aliases.
  tsconfig: './tsconfig.build.json',
});
