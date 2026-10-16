import path from 'path';
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

const NODE_ENV = process.env.WIZARD_BUILD_NODE_ENV || 'production';

// Dev-only modules (and everything under them) that production builds replace
// with an empty stub, so their code isn't even emitted as an unreachable chunk.
// Reach them only through an `import()` behind `!IS_PRODUCTION_BUILD`, which
// those builds drop; a static value import fails the build on the empty stub.
// `pnpm check:decisions-bundle` verifies the result.
const DEV_ONLY_MODULES = [
  'src/programs/detection/decisions',
  'src/programs/posthog-integration/decisions',
].map((dir) => path.resolve(dir));
const DEV_ONLY_STUB = '\0dev-only-stub';

function stubDevOnlyModules() {
  return {
    name: 'stub-dev-only-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith('.')) return null;
      const target = path
        .resolve(path.dirname(importer), source)
        .replace(/\.[jt]s$/, '');
      const devOnly = DEV_ONLY_MODULES.some(
        (dir) => target === dir || target.startsWith(dir + path.sep),
      );
      return devOnly ? DEV_ONLY_STUB : null;
    },
    load(id: string) {
      return id === DEV_ONLY_STUB ? 'export {};' : null;
    },
  };
}

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
    NODE_ENV,
  },

  plugins: NODE_ENV === 'production' ? [stubDevOnlyModules()] : [],

  // Keep npm dependencies external — they're installed at runtime.
  skipNodeModulesBundle: true,

  sourcemap: true,
  clean: true,

  // One config for every file: the per-layer tsconfigs map only their own aliases.
  tsconfig: './tsconfig.base.json',
});
