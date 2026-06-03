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
 * that aren't supported in the shipped package — e.g. `--ci` mode.
 */
export const IS_PRODUCTION_BUILD = process.env.NODE_ENV === 'production';

// ── Runtime environment ──────────────────────────────────────────────

/**
 * Exhaustive allowlist of env vars the wizard reads at runtime.
 * Add new keys here when a new runtime dependency is needed.
 */
type RuntimeEnvKey =
  // Wizard CLI configuration (yargs POSTHOG_WIZARD_ prefix)
  | 'POSTHOG_WIZARD_BENCHMARK_CONFIG'
  | 'POSTHOG_WIZARD_BENCHMARK_FILE'
  | 'POSTHOG_WIZARD_LOG_DIR'
  | 'POSTHOG_WIZARD_DEBUG'
  | 'DEBUG'
  // Agent / MCP
  | 'MCP_URL'
  | 'POSTHOG_API_KEY'
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

/** Read a runtime environment variable. Only allowlisted keys compile. */
export function runtimeEnv(key: RuntimeEnvKey): string | undefined {
  return process.env[key];
}
