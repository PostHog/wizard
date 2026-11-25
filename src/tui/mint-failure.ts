import { ErrorCodes } from '@shared/errors';
import { redactSecrets, scrubHomePaths } from '@shared/mcp-clients/results';
import { getProcessLogTail } from '@utils/debug';
import { OutroKind } from '@shared/outro';
import type { WizardSession } from '@programs/types';

export type FailureCopy = {
  headline: string;
  cause: string;
  rerun: string;
  asksAboutLog: boolean;
  canHandOffToAgent: boolean;
};

const CAPACITY_COPY: FailureCopy = {
  headline: 'The wizard is busy right now',
  cause: "The wizard's AI service is busy, so setup stopped before finishing.",
  rerun: 'Run the wizard again in a few minutes:',
  asksAboutLog: true,
  canHandOffToAgent: true,
};

const RUN_FAILURE_COPY: FailureCopy = {
  headline: "PostHog isn't set up yet",
  cause:
    'The wizard ran into a problem partway through and stopped before finishing.',
  rerun: 'Run the wizard again:',
  asksAboutLog: true,
  canHandOffToAgent: true,
};

const LOGIN_COPY = new Map<string, FailureCopy>([
  [
    ErrorCodes.AuthLoginFailed,
    {
      headline: "You're not logged in yet",
      cause:
        "PostHog couldn't finish the login, so the wizard stopped before setup.",
      rerun: 'Run the wizard again and log in:',
      asksAboutLog: true,
      canHandOffToAgent: false,
    },
  ],
  [
    ErrorCodes.AuthProjectFetchFailed,
    {
      headline: "Your PostHog project didn't load",
      cause: "You logged in, but the wizard couldn't load your project.",
      rerun: 'Check your connection, then run the wizard again:',
      asksAboutLog: true,
      canHandOffToAgent: false,
    },
  ],
  [
    ErrorCodes.AuthAccessDenied,
    {
      headline: "You didn't authorize the wizard",
      cause: 'The wizard needs access to your PostHog account to set it up.',
      rerun: 'To try again, run the wizard and approve access:',
      asksAboutLog: false,
      canHandOffToAgent: false,
    },
  ],
]);

export const REPORTED_NOTE = 'We got the error automatically.';

export const LOG_QUESTION = 'Send your log too?';

export const LOG_PROMPT =
  'It helps us find the cause. We mask the keys and tokens we recognize.';

export const LOG_SENT_NOTE = 'Log sent. Thanks, it helps us fix this.';

export const RERUN_COMMAND = 'npx @posthog/wizard@latest';

export const AGENT_HANDOFF_STEP =
  'Or hand it to your own agent. The saved skill has every step.';

// A security stop or the agent's own [ABORT] is a decision, not an outage:
// it shows its own outro, never the busy handoff.
const DECISIONS = new Set<string>([
  ErrorCodes.AgentYaraViolation,
  ErrorCodes.AgentAbort,
  ErrorCodes.DetectUnsupportedPlatform,
]);

/** The run ended in an error the handoff screen explains: an agent run with
 *  credentials, or a login failure with its own copy. Other login failures keep
 *  their specific outro. */
export function isRunFailure(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): boolean {
  const errorCode = session.outroData?.errorCode ?? '';
  return (
    session.outroData?.kind === OutroKind.Error &&
    !DECISIONS.has(errorCode) &&
    (session.credentials !== null || LOGIN_COPY.has(errorCode))
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

export function failureReportProperties(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): Record<string, unknown> {
  return {
    error_code: session.outroData?.errorCode,
    message: scrubHomePaths(redactSecrets(session.outroData?.message ?? '')),
    is_capacity: isCapacityFailure(session),
    log_tail: scrubHomePaths(redactSecrets(getProcessLogTail())),
  };
}

export function failureCopy(
  session: Pick<WizardSession, 'outroData' | 'credentials'>,
): FailureCopy {
  const loginCopy = LOGIN_COPY.get(session.outroData?.errorCode ?? '');
  if (loginCopy) return loginCopy;
  return isCapacityFailure(session) ? CAPACITY_COPY : RUN_FAILURE_COPY;
}
