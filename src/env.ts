/**
 * Central environment variable access for the PostHog wizard.
 *
 * ── Build-time constants ────────────────────────────────────────────
 * Inlined by tsdown's `env` option at compile time. After build, the
 * runtime value of these env vars has zero effect on the wizard.
 *
 * ── Runtime variables ───────────────────────────────────────────────
 * Read through `runtimeEnv()` with a typed allowlist. This makes every
 * runtime dependency on the environment explicit and grep-able.
 *
 * ── Direct process.env access ───────────────────────────────────────
 * Reserved for subprocess environment configuration (writes) and
 * vendored code. Production source outside those cases should use
 * this module instead.
 */

// ── Build-time constants ─────────────────────────────────────────────
// tsdown replaces `process.env.NODE_ENV` with a string literal.
// After build these are just `"production"`, `false`, etc.

export const NODE_ENV = process.env.NODE_ENV as string;
export const IS_DEV =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

/**
 * True only in published/production builds. tsdown inlines
 * `process.env.NODE_ENV` as the literal `"production"` at build time, so this
 * collapses to `true` in `dist/` and stays `false` for `tsx`/dev/test runs
 * (where NODE_ENV is unset, `development`, or `test`). Used to gate features
 * that aren't supported in the shipped package — `--ci` mode and the
 * `WIZARD_*` env vars, which are dev/CI-only knobs (see `runtimeEnv` and
 * `wizard.ts`). End users drive published builds through flags only.
 */
export const IS_PRODUCTION_BUILD = process.env.NODE_ENV === 'production';

// ── Runtime environment ──────────────────────────────────────────────

/**
 * Exhaustive allowlist of env vars the wizard reads at runtime.
 * Add new keys here when a new runtime dependency is needed.
 */
type RuntimeEnvKey =
  // Wizard CLI configuration (WIZARD_ prefix; dev/CI-only — gated out of
  // published builds, see runtimeEnv below)
  | 'WIZARD_BENCHMARK_CONFIG'
  | 'WIZARD_BENCHMARK_FILE'
  | 'WIZARD_LOG_DIR'
  | 'WIZARD_DEBUG'
  | 'DEBUG'
  // Agent / MCP
  | 'MCP_URL'
  // Platform: terminal detection
  | 'TERM'
  | 'TERM_PROGRAM'
  | 'TERMINAL_EMULATOR'
  | 'CI'
  | 'WT_SESSION'
  | 'TERMINUS_SUBLIME'
  | 'ConEmuTask'
  // Platform: paths
  | 'APPDATA'
  | 'XDG_CONFIG_HOME';

/**
 * Read a runtime environment variable. Only allowlisted keys compile.
 *
 * `WIZARD_*` keys are dev/CI-only configuration knobs; they are ignored in
 * published builds (`IS_PRODUCTION_BUILD`) so the shipped package can't be
 * driven by environment variables — end users use flags instead.
 */
export function runtimeEnv(key: RuntimeEnvKey): string | undefined {
  if (IS_PRODUCTION_BUILD && key.startsWith('WIZARD_')) return undefined;
  return process.env[key];
}

// ── CLI option env overrides ─────────────────────────────────────────
// Each global/command flag can also be set via a `WIZARD_<NAME>` env var
// in dev/CI (e.g. `WIZARD_API_KEY` backs `--api-key`). These are wired as
// per-option yargs defaults rather than yargs' `.env()` prefix on purpose:
// the prefix greedily claims the whole `WIZARD_*` namespace and, under
// strictOptions, rejects any stray var in it (the build's own
// `WIZARD_BUILD_NODE_ENV`, the workbench's `WIZARD_PATH`, …). Reading only
// the names we declare keeps unrelated `WIZARD_*` vars from breaking parsing.
// Published builds ignore them (`IS_PRODUCTION_BUILD`) — flags only.

/** Raw `WIZARD_<NAME>` option override, or undefined (dev/CI only). */
function optionEnv(name: string): string | undefined {
  if (IS_PRODUCTION_BUILD) return undefined;
  const value = process.env[`WIZARD_${name}`];
  return value == null || value === '' ? undefined : value;
}

/**
 * `WIZARD_<NAME>` as a spreadable yargs string-option default, e.g.
 * `{ ...wizardEnvDefault('API_KEY') }`. Returns `{ default }` only when the env
 * var is set; otherwise `{}`, so the option keeps its native no-default parsing
 * (a bare `--skill` still yields `''`, which validation relies on).
 */
export function wizardEnvDefault(name: string): { default?: string } {
  const value = optionEnv(name);
  return value === undefined ? {} : { default: value };
}

/**
 * `WIZARD_<NAME>` as a yargs boolean-option default. Falls back to `fallback`
 * when unset; otherwise anything but `0`/`false`/`no` is truthy.
 */
export function wizardEnvBool(name: string, fallback: boolean): boolean {
  const value = optionEnv(name);
  if (value == null) return fallback;
  const norm = value.toLowerCase();
  return norm !== '0' && norm !== 'false' && norm !== 'no';
}
