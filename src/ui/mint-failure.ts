import { OutroKind, type WizardSession } from '@lib/wizard-session';
import { ErrorCodes } from '@lib/errors';

export const MINT_FAILURE_MESSAGE = "The Wizard's a little busy";

export const MINT_FAILURE_BODY =
  'The wizard can still share spells. Grab a skill and let your agent take over.';

export const MINT_FAILURE_CONTACT =
  'Email wizard@posthog.com and tell us what happened. Please attach this log:';

/** The agent run ended in an error, whatever the reason. Login failures also
 *  set an error outro but never had credentials, so they stay on the outro. */
export function isRunFailure(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): boolean {
  return (
    session.outroData?.kind === OutroKind.Error && session.credentials !== null
  );
}

/** Gateway codes whose message says why this run cannot start. */
const GATEWAY_CODES: readonly string[] = [
  ErrorCodes.GatewayMintRefused,
  ErrorCodes.GatewayMintFailed,
];

/**
 * Why the gateway would not serve this run, for the handoff screen.
 *
 * A refusal carries a message the user can act on — a login to renew, a run
 * limit to wait out — and the screen's own copy says none of that, so without
 * this the user reads "the wizard is busy" and retries into the same wall.
 */
export function mintFailureReason(
  session: Pick<WizardSession, 'outroData'>,
): string | undefined {
  const outro = session.outroData;
  if (!outro || outro.kind !== OutroKind.Error) return undefined;
  if (!outro.errorCode || !GATEWAY_CODES.includes(outro.errorCode)) {
    return undefined;
  }
  return outro.message || undefined;
}
