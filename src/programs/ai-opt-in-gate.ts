/**
 * AI opt-in gate — step injection for programs whose agent run sends
 * source to Anthropic Claude.
 *
 * Injected after the `auth` step for every program that doesn't declare
 * `requiresAi: false`. The injected step carries three predicates:
 *
 *   show       — renders AiOptInRequiredScreen when the org hasn't
 *                approved third-party AI
 *   isComplete — router advances once approval lands
 *   gate       — `await store.getGate('ai-opt-in')` parks the agent
 *                runner until approval lands. THIS is the enforcement:
 *                the screen alone is cosmetic; the gate is what stops
 *                source from leaving the machine.
 *
 * Used by BOTH screen-sequences.ts (screen injection) and the store's
 * _initFromProgram (gate registration) so the two layers can't drift.
 *
 * The predicates mirror Max's strict reading of
 * `organization.is_ai_data_processing_approved`: only literal `true`
 * proceeds; `null` / `undefined` / `false` all block. CI and signup
 * sessions skip the gate:
 *   - `--ci` auto-consents to AI usage per the README, and the
 *     interactive kill screen would be unworkable headless.
 *   - signup (account provisioning) auto-consents too: the provisioning
 *     access token deliberately omits the `organization:read` scope
 *     (`WIZARD_PROVISIONING_SCOPES` in constants.ts), so the org's
 *     approval can never be read back — `apiUser` stays null and the gate
 *     could never clear. Creating an account through the wizard to run the
 *     AI agent is itself the consent, mirroring how `shouldDisableAsk`
 *     already treats `ci || signup` as one non-interactive mode.
 */

import type { WizardSession } from '@lib/wizard-session';
import type { ProgramConfig, ProgramStep } from './program-step.js';

/** Step id — also the ScreenId.AiOptIn enum value in screen-sequences. */
export const AI_OPT_IN_STEP_ID = 'ai-opt-in';

function aiApproved(session: WizardSession): boolean {
  return !!session.apiUser?.organization?.is_ai_data_processing_approved;
}

/**
 * Returns the program's steps with the AI opt-in gate injected after
 * `auth`. Programs with `requiresAi: false` or no auth step pass
 * through unchanged — without auth, `apiUser` would never be populated
 * for evaluation anyway.
 */
export function withAiOptInGate(config: ProgramConfig): ProgramStep[] {
  if (config.requiresAi === false) return config.steps;

  const authIdx = config.steps.findIndex((s) => s.id === 'auth');
  if (authIdx === -1) return config.steps;

  const gateStep: ProgramStep = {
    id: AI_OPT_IN_STEP_ID,
    label: 'AI opt-in check',
    screenId: AI_OPT_IN_STEP_ID,
    // Only fire once apiUser has actually been populated — between
    // setCredentials and setApiUser there's a brief emitChange window
    // where apiUser is null, and we don't want to flash the gate then.
    show: (session) =>
      !session.ci &&
      !session.signup &&
      session.apiUser != null &&
      !aiApproved(session),
    isComplete: (session) =>
      session.ci || session.signup || aiApproved(session),
    gate: (session) => session.ci || session.signup || aiApproved(session),
  };

  return [
    ...config.steps.slice(0, authIdx + 1),
    gateStep,
    ...config.steps.slice(authIdx + 1),
  ];
}
