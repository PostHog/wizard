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
 *     AI agent is itself the consent, mirroring how `isAskDisabled`
 *     already treats `ci || signup` as one non-interactive mode.
 */

import type { ApiUser } from '@shared/api';
import type { ProgramConfig } from '@programs/types';
import type { FlowStep } from '../flow';

/** Step id — also the ScreenId.AiOptIn enum value in screen-sequences. */
export const AI_OPT_IN_STEP_ID = 'ai-opt-in';

function aiApproved(user: ApiUser | null): boolean {
  return !!user?.organization?.is_ai_data_processing_approved;
}

/**
 * Returns the program's flow with the AI opt-in gate injected after
 * `auth`. Programs with `requiresAi: false` or no auth step pass
 * through unchanged — without auth, `apiUser` would never be populated
 * for evaluation anyway.
 */
export function withAiOptInGate(
  config: Pick<ProgramConfig, 'requiresAi'>,
  flow: FlowStep[],
): FlowStep[] {
  if (config.requiresAi === false) return flow;

  const authIdx = flow.findIndex((s) => s.id === 'auth');
  if (authIdx === -1) return flow;

  const gateStep: FlowStep = {
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
      !aiApproved(session.apiUser),
    isComplete: (session) =>
      session.ci || session.signup || aiApproved(session.apiUser),
    gate: (session) =>
      session.ci || session.signup || aiApproved(session.apiUser),
  };

  return [...flow.slice(0, authIdx + 1), gateStep, ...flow.slice(authIdx + 1)];
}
