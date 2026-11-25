import { ErrorCodes } from '@shared/errors';
import { redactSecrets, scrubHomePaths } from '@shared/mcp-clients/results';
import { getLogFilePath, getProcessLogStart } from '@utils/debug';
import { readFileTail } from '@utils/bounded-fs';
import { OutroKind } from '@shared/outro';
import type { WizardSession } from '@programs/types';

export type FailureCopy = { headline: string; cause: string; fix: string };

const CAPACITY_COPY: FailureCopy = {
  headline: 'The wizard is busy right now',
  cause: "The wizard's AI service is busy, so setup stopped before finishing.",
  fix: 'Try this: run the wizard again in a few minutes, or hand the setup to your own agent with the saved skill.',
};

const RUN_FAILURE_COPY: FailureCopy = {
  headline: "PostHog isn't set up yet",
  cause:
    'The wizard ran into a problem partway through and stopped before finishing.',
  fix: 'Try this: run the wizard again, or hand the setup to your own agent with the saved skill.',
};

export const REPORTED_NOTE =
  'We got the error automatically, but not your log. Sending it helps us find the cause.';

export const LOG_SENT_NOTE = 'Log sent. Thanks, it helps us fix this.';

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

const CAPACITY = new Set<string>([
  ErrorCodes.AgentRateLimit,
  ErrorCodes.AgentApiError,
  ErrorCodes.GatewayMintRefused,
  ErrorCodes.GatewayMintFailed,
  ErrorCodes.EnvServiceOutage,
]);

export function isCapacityFailure(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): boolean {
  return (
    isRunFailure(session) && CAPACITY.has(session.outroData?.errorCode ?? '')
  );
}

const LOG_TAIL_BYTES = 64 * 1024;

function readRunLog(): string {
  const start = getProcessLogStart();
  if (start === null) return '';
  const tail = readFileTail(getLogFilePath(), LOG_TAIL_BYTES, start);
  if (tail === null) return '[log unreadable]';
  if (!tail.truncated) return tail.text;
  return tail.text.slice(tail.text.indexOf('\n') + 1);
}

export function failureReportProperties(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): Record<string, unknown> {
  return {
    error_code: session.outroData?.errorCode,
    message: scrubHomePaths(redactSecrets(session.outroData?.message ?? '')),
    is_capacity: isCapacityFailure(session),
    log_tail: scrubHomePaths(redactSecrets(readRunLog())),
  };
}

export function failureCopy(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): FailureCopy {
  return isCapacityFailure(session) ? CAPACITY_COPY : RUN_FAILURE_COPY;
}
