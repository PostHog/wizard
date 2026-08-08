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

  // Keep npm dependencies external — they're installed at runtime — with one
  // exception: semver is bundled into the output.
  //
  // semver's entry file eagerly `require()`s its entire ./functions/* and
  // ./ranges/* submodule tree at load. When a package runner (npx/bunx)
  // extracts a corrupted/partial semver tarball into its cache (a known failure
  // mode when antivirus or a concurrent run interrupts extraction), that eager
  // require throws MODULE_NOT_FOUND (e.g. './ranges/intersects', './functions/sort')
  // before any wizard code runs — an instant, unrecoverable startup crash.
  // Bundling semver means a corrupted runtime install can no longer surface a
  // missing-submodule crash. semver is dependency-free, so this is self-contained.
  //
  // Note: `deps.skipNodeModulesBundle` and `deps.alwaysBundle` are mutually
  // exclusive in tsdown, so we rely on the default behavior (externalize
  // production dependencies declared in package.json) and force-bundle semver.
  deps: {
    alwaysBundle: ['semver'],
  },

  sourcemap: true,
  clean: true,

  // Path aliases — resolved from tsconfig.json paths automatically.
  // tsdown/rolldown reads the "paths" field in tsconfig.build.json.
});
