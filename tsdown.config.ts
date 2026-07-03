import { defineConfig } from 'tsdown';

/** Bundle `.md` imports as strings (switchboard prompt notes). */
const mdAsText = {
  name: 'md-as-text',
  transform(code: string, id: string) {
    if (!id.endsWith('.md')) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

export default defineConfig({
  plugins: [mdAsText],
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

  // Keep npm dependencies external — they're installed at runtime.
  skipNodeModulesBundle: true,

  sourcemap: true,
  clean: true,

  // Path aliases — resolved from tsconfig.json paths automatically.
  // tsdown/rolldown reads the "paths" field in tsconfig.build.json.
});
