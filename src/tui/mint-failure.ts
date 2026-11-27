import { ErrorCodes, type ErrorCode } from '@shared/errors';
import { redactSecrets, scrubHomePaths } from '@shared/mcp-clients/results';
import { getProcessLogTail } from '@utils/debug';
import { OutroKind } from '@shared/outro';
import { findProgramConfig, Program, type ProgramId } from '@programs';
import type { WizardSession } from '@programs/types';

type FailureSession = Pick<WizardSession, 'outroData' | 'credentials'>;

type FailureCopy = {
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
  headline: "The wizard didn't finish",
  cause:
    'The wizard ran into a problem partway through and stopped before finishing.',
  rerun: 'Run the wizard again:',
  asksAboutLog: true,
  canHandOffToAgent: true,
};

const INTEGRATION_FAILURE_COPY: FailureCopy = {
  ...RUN_FAILURE_COPY,
  headline: "PostHog isn't set up yet",
};

const SAME_COMMAND_RERUN = 'Run the same wizard command again.';

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

type FailureRoute = 'outro' | 'run' | 'capacity' | 'login';

// Exhaustive so a new code fails typecheck until it picks a route; `outro` keeps its own fix screen.
const FAILURE_ROUTES: Record<ErrorCode, FailureRoute> = {
  [ErrorCodes.CliNodeVersion]: 'outro',
  [ErrorCodes.CliBadArgs]: 'outro',
  [ErrorCodes.CliFlagUnavailable]: 'outro',
  [ErrorCodes.CliInteractiveRequired]: 'outro',
  [ErrorCodes.ArgsMissingApiKey]: 'outro',
  [ErrorCodes.ArgsMissingInstallDir]: 'outro',
  [ErrorCodes.ArgsMissingEmail]: 'outro',
  [ErrorCodes.ArgsSignupProvisionFailed]: 'outro',
  [ErrorCodes.AuthKeyType]: 'outro',
  [ErrorCodes.AuthMissingScope]: 'outro',
  [ErrorCodes.AuthRegionMismatch]: 'outro',
  [ErrorCodes.AuthInvalidOrExpired]: 'outro',
  [ErrorCodes.AuthSessionExpired]: 'outro',
  [ErrorCodes.AuthSettingsConflict]: 'outro',
  [ErrorCodes.AuthStoredLoginConflict]: 'outro',
  [ErrorCodes.AuthProjectFetchFailed]: 'login',
  [ErrorCodes.AuthLoginFailed]: 'login',
  [ErrorCodes.AuthAccessDenied]: 'login',
  [ErrorCodes.EnvLocalServicesDown]: 'outro',
  [ErrorCodes.EnvServiceOutage]: 'capacity',
  [ErrorCodes.DetectBadDirectory]: 'outro',
  [ErrorCodes.DetectNoFramework]: 'outro',
  [ErrorCodes.DetectUnsupportedVersion]: 'outro',
  [ErrorCodes.DetectUnsupportedPlatform]: 'outro',
  [ErrorCodes.DetectNoPosthogSdk]: 'outro',
  [ErrorCodes.DetectSdkTooOld]: 'outro',
  [ErrorCodes.DetectNoProjectFiles]: 'outro',
  [ErrorCodes.DetectNoSources]: 'outro',
  [ErrorCodes.DetectNoPackageJson]: 'outro',
  [ErrorCodes.DetectNoSdks]: 'outro',
  [ErrorCodes.DetectMissingStripe]: 'outro',
  [ErrorCodes.DetectUnclassified]: 'outro',
  [ErrorCodes.SkillMenuFetchFailed]: 'run',
  [ErrorCodes.SkillNotFound]: 'outro',
  [ErrorCodes.SkillDownloadFailed]: 'run',
  [ErrorCodes.AgentAbort]: 'outro',
  [ErrorCodes.AgenticDetectionTimeout]: 'run',
  [ErrorCodes.AgentMcpMissing]: 'run',
  [ErrorCodes.AgentResourceMissing]: 'run',
  [ErrorCodes.AgentRateLimit]: 'capacity',
  [ErrorCodes.AgentApiError]: 'run',
  [ErrorCodes.AgentYaraViolation]: 'outro',
  [ErrorCodes.AgentNoProgress]: 'run',
  [ErrorCodes.AgentInvalidStructuredOutput]: 'run',
  [ErrorCodes.AgentIncompleteTasks]: 'run',
  [ErrorCodes.AgentOrchestratorSkillVariantMissing]: 'run',
  [ErrorCodes.AgentOrchestratorTasksFailed]: 'run',
  [ErrorCodes.AgentOrchestratorTasksBlocked]: 'run',
  [ErrorCodes.AgentOrchestratorHollowRun]: 'run',
  [ErrorCodes.AgentOrchestratorSinkInvariant]: 'run',
  [ErrorCodes.AgentOrchestratorTaskGraph]: 'run',
  [ErrorCodes.AgentOrchestratorNoPlanner]: 'run',
  [ErrorCodes.GatewayMintRefused]: 'run',
  [ErrorCodes.GatewayMintFailed]: 'capacity',
  [ErrorCodes.SettingsUnfixableConflict]: 'outro',
  [ErrorCodes.InternalUnhandled]: 'run',
};

function failureRoute(session: FailureSession): FailureRoute | null {
  const outro = session.outroData;
  if (outro?.kind !== OutroKind.Error) return null;
  const errorCode = outro.errorCode;
  return (errorCode && FAILURE_ROUTES[errorCode]) || 'run';
}

/** The run ended in an error the handoff screen explains. Only program runs
 *  wait on the handoff; a tool keeps its own outro. */
export function isRunFailure(
  session: FailureSession,
  programId: ProgramId,
): boolean {
  if (!findProgramConfig(programId)) return false;
  const route = failureRoute(session);
  if (route === null || route === 'outro') return false;
  if (route === 'login') return true;
  return session.credentials !== null;
}

function isCapacityFailure(
  session: FailureSession,
  programId: ProgramId,
): boolean {
  return (
    isRunFailure(session, programId) && failureRoute(session) === 'capacity'
  );
}

/** The command that reruns the program, or null when the program has no command of its own (a dispatched skill). */
export function rerunCommand(programId: ProgramId): string | null {
  if (programId === Program.PostHogIntegration) return RERUN_COMMAND;
  const config = findProgramConfig(programId);
  if (!config?.command) return null;
  return [RERUN_COMMAND, config.parentCommand, config.command]
    .filter(Boolean)
    .join(' ');
}

export function failureReportProperties(
  session: FailureSession,
  programId: ProgramId,
): Record<string, unknown> {
  return {
    error_code: session.outroData?.errorCode,
    message: scrubHomePaths(redactSecrets(session.outroData?.message ?? '')),
    is_capacity: isCapacityFailure(session, programId),
    log_tail: scrubHomePaths(redactSecrets(getProcessLogTail())),
  };
}

export function failureCopy(
  session: FailureSession,
  programId: ProgramId,
): FailureCopy {
  const copy = baseFailureCopy(session, programId);
  if (rerunCommand(programId) !== null) return copy;
  return { ...copy, rerun: SAME_COMMAND_RERUN };
}

function baseFailureCopy(
  session: FailureSession,
  programId: ProgramId,
): FailureCopy {
  const loginCopy = LOGIN_COPY.get(session.outroData?.errorCode ?? '');
  if (loginCopy) return loginCopy;
  if (isCapacityFailure(session, programId)) return CAPACITY_COPY;
  if (programId === Program.PostHogIntegration) return INTEGRATION_FAILURE_COPY;
  return RUN_FAILURE_COPY;
}
