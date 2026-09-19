import type { WizardSession } from './wizard-session.js';

/**
 * Decide whether the `wizard_ask` overlay should be wired for this run.
 * Disabled in non-interactive modes (CI, signup) — there's no human to
 * answer. Per-program disabling is done by adding WIZARD_ASK_TOOL_NAME to
 * the program's `disallowedTools` so the SDK rejects calls outright.
 * Extracted so the policy can be unit-tested directly.
 *
 * `session.e2eAsk` is the one escape hatch. The e2e harness runs a `ci`
 * session, but it does have an answerer — the driver loop answers each
 * `wizard_ask` batch from the program's e2e profile. Without the flag the
 * agent-in-the-loop layer (the ask bridge in both sequence arms, and the
 * orchestrator's seeded warehouse task) stays unreachable from a test.
 *
 * Only the e2e TUI host sets the flag, from the `E2E_ASK` env var. No CLI flag
 * populates it, so plain `--ci` and `--signup` runs behave exactly as before.
 */
export function shouldDisableAsk(
  session: Pick<WizardSession, 'ci' | 'signup' | 'e2eAsk'>,
): boolean {
  return (session.ci || session.signup) && !session.e2eAsk;
}
