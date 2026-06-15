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
  //
  // Published builds inline `production` (which disables `--ci`; see src/env.ts).
  // CI/test harnesses that need `--ci` build with WIZARD_BUILD_NODE_ENV=ci via
  // the `build:ci` script: `'ci'` flips only IS_PRODUCTION_BUILD to false, while
  // IS_DEV and the `NODE_ENV === 'test'` mock paths stay exactly as in prod.
  env: {
    NODE_ENV: process.env.WIZARD_BUILD_NODE_ENV || 'production',
    // Analytics build channel, decoupled from NODE_ENV so a build can tag its
    // events 'dev'/'ci' without flipping IS_DEV (URLs, --ci gating). Empty here
    // → resolves to 'prod' in src/env.ts. The `dev`/`try`/`build:ci` scripts set
    // WIZARD_BUILD_CHANNEL so those builds tag themselves non-prod.
    WIZARD_BUILD_CHANNEL: process.env.WIZARD_BUILD_CHANNEL || '',
  },

  // Keep npm dependencies external — they're installed at runtime.
  skipNodeModulesBundle: true,

  sourcemap: true,
  clean: true,

  // Path aliases — resolved from tsconfig.json paths automatically.
  // tsdown/rolldown reads the "paths" field in tsconfig.build.json.
});
