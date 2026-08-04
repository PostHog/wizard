/** Shared by the credential helper and the code that installs it. */

/** Set as `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`. */
export const HELPER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Must stay wider than {@link HELPER_CACHE_TTL_MS}, because a result cached for
 * the full window has to still be valid when that window ends.
 */
export const REFRESH_SKEW_MS = 15 * 60 * 1000;

/** A lock older than this belonged to a process that died holding it. */
export const LOCK_STALE_MS = 30 * 1000;

/** Names the state file, since the SDK spawns the helper with no arguments. */
export const AUTH_STATE_ENV = 'POSTHOG_WIZARD_AUTH_STATE';
