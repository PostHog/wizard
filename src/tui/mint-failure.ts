import { ErrorCodes } from '@shared/errors';
import { OutroKind } from '@shared/outro';
import type { WizardSession } from '@programs/types';

export const MINT_FAILURE_MESSAGE = "The Wizard's a little busy";

export const MINT_FAILURE_BODY =
  'The wizard can still share spells. Grab a skill and let your agent take over.';

export const MINT_FAILURE_CONTACT =
  'Email wizard@posthog.com and tell us what happened. Please attach this log:';

// A security stop or the agent's own [ABORT] is a decision, not an outage:
// it shows its own outro, never the busy handoff.
const DECISIONS = new Set<string>([
  ErrorCodes.AgentYaraViolation,
  ErrorCodes.AgentAbort,
  ErrorCodes.DetectUnsupportedPlatform,
]);

/** The agent run ended in an error, whatever the reason. Login failures also
 *  set an error outro but never had credentials, so they stay on the outro. */
export function isRunFailure(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): boolean {
  return (
    session.outroData?.kind === OutroKind.Error &&
    session.credentials !== null &&
    !DECISIONS.has(session.outroData.errorCode ?? '')
  );
}
