import { ErrorCodes } from '@lib/errors/codes';
import { OutroKind, type OutroData } from '@lib/wizard-session';

export const MINT_FAILURE_MESSAGE =
  "The wizard's a little occupied right now, would you like the Wizard to leave it's spell book behind for your agent to complete the setup?";

export const MINT_FAILURE_CONTACT =
  'If you would really like to use the Wizard, please contact wizard@posthog.com.';

export function isMintFailure(data: OutroData | null | undefined): boolean {
  return (
    data?.kind === OutroKind.Error &&
    (data.errorCode === ErrorCodes.GatewayMintRefused ||
      data.errorCode === ErrorCodes.GatewayMintFailed)
  );
}
