import { ErrorCodes } from '@lib/errors/codes';
import { OutroKind, type OutroData } from '@lib/wizard-session';

export const MINT_FAILURE_MESSAGE =
  "The Wizard's a little busy right now, but he can leave his spell books for your agent to carry out the task";

export const MINT_FAILURE_CONTACT =
  'Email wizard@posthog.com and tell us what happened. Please attach this log:';

export function isMintFailure(data: OutroData | null | undefined): boolean {
  return (
    data?.kind === OutroKind.Error &&
    (data.errorCode === ErrorCodes.GatewayMintRefused ||
      data.errorCode === ErrorCodes.GatewayMintFailed)
  );
}
