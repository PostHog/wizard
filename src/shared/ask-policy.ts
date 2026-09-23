/** When a run may put a `wizard_ask` question to a person, and how long it waits. */

/**
 * Whether the `wizard_ask` overlay stays unwired for this run. Non-interactive
 * modes (CI, signup) have no human to answer. Per-program disabling adds
 * WIZARD_ASK_TOOL_NAME to the program's `disallowedTools` instead, so the SDK
 * rejects calls outright.
 *
 * `e2eAsk` is the one escape hatch. The e2e harness runs a `ci` session, but it
 * does have an answerer: the driver loop answers each `wizard_ask` batch from
 * the program's e2e profile. Without the flag the agent-in-the-loop layer (the
 * ask bridge in both sequence arms, and the orchestrator's seeded warehouse
 * task) stays unreachable from a test.
 *
 * Only the e2e TUI host sets the flag, from the `E2E_ASK` env var. No CLI flag
 * populates it, so plain `--ci` and `--signup` runs keep the overlay unwired.
 */
export function isAskDisabled(flags: {
  ci: boolean;
  signup: boolean;
  e2eAsk: boolean;
}): boolean {
  return (flags.ci || flags.signup) && !flags.e2eAsk;
}

/**
 * The longer per-question timeout, for asks that send the user on an errand —
 * open a database console, mint a restricted API key. The default is sized for
 * a question answerable from memory and expires long before an errand is done.
 */
export const LONGER_ASK_TIMEOUT_MS = 20 * 60 * 1000;
