import { ErrorCodes } from '@shared/errors';
import { redactSecrets, scrubHomePaths } from '@shared/mcp-clients/results';
import { getLogFilePath, getProcessLogStart } from '@utils/debug';
import { readFileTail } from '@utils/bounded-fs';
import { OutroKind } from '@shared/outro';
import type { WizardSession } from '@programs/types';

export const MINT_FAILURE_MESSAGE = "The Wizard's a little busy";

export const MINT_FAILURE_BODY =
  'The wizard can still share spells. Grab a skill and let your agent take over.';

export const RUN_FAILURE_HEADLINE = "The wizard couldn't finish setup";

export const RUN_FAILURE_BODY = 'Grab a skill and let your agent take over.';

export const REPORT_PROMPT =
  "Send this failure and this run's wizard log to the wizard team? Keys and tokens we recognize, and your home folder, are masked first.";

export const REPORT_SENT = 'Report sent to the wizard team.';

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
    message: session.outroData?.message,
    is_capacity: isCapacityFailure(session),
    log_tail: scrubHomePaths(redactSecrets(readRunLog())),
  };
}
