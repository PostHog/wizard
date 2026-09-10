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
  },

  // Keep npm dependencies external — they're installed at runtime — except the
  // ones listed in `deps.alwaysBundle`.
  deps: {
    // Bundle jsonc-parser in. Its UMD entry (the package `main` field) does a
    // relative `require('./impl/format')` at load time. Left external, that
    // require survives into a downstream single-file build and cannot resolve
    // inside Node's embedded runtime, which crashes the wizard at boot.
    alwaysBundle: [/^jsonc-parser/],
  },

  // Resolve jsonc-parser to its ESM build. The package `main` field is a UMD
  // bundle whose runtime `require('./impl/format')` the bundler keeps verbatim;
  // the ESM build uses static imports the bundler resolves and inlines at build
  // time, so no runtime require survives.
  alias: {
    'jsonc-parser': 'jsonc-parser/lib/esm/main.js',
  },

  sourcemap: true,
  clean: true,

  // Path aliases — resolved from tsconfig.json paths automatically.
  // tsdown/rolldown reads the "paths" field in tsconfig.build.json.
});
