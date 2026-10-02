import type { RunFlags } from '@agent/types';

/**
 * Decide whether the `wizard_ask` overlay should be wired for this run.
 * Disabled in non-interactive modes (CI, signup) — there's no human to
 * answer. Per-program disabling is done by adding WIZARD_ASK_TOOL_NAME to
 * the program's `disallowedTools` so the SDK rejects calls outright.
 * Extracted so the policy can be unit-tested directly.
 *
 * `e2eAsk` is the one escape hatch. The e2e harness runs a `ci`
 * session, but it does have an answerer — the driver loop answers each
 * `wizard_ask` batch from the program's e2e profile. Without the flag the
 * agent-in-the-loop layer (the ask bridge in both sequence arms, and the
 * orchestrator's seeded warehouse task) stays unreachable from a test.
 *
 * Only the e2e TUI host sets the flag, from the `E2E_ASK` env var. No CLI flag
 * populates it, so plain `--ci` and `--signup` runs behave exactly as before.
 */
export function shouldDisableAsk(
  flags: Pick<RunFlags, 'ci' | 'signup' | 'e2eAsk'>,
): boolean {
  return (flags.ci || flags.signup) && !flags.e2eAsk;
}

/** Default per-question timeout (5 minutes). */
export const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The longer per-question timeout, for asks that send the user on an errand —
 * open a database console, mint a restricted API key. The default above is
 * sized for a question answerable from memory and expires long before an
 * errand is done.
 */
export const LONGER_ASK_TIMEOUT_MS = 20 * 60 * 1000;
