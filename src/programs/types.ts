/** Public type entry for the programs surface. */
export type { SubcommandProgram } from './runner/program-registry';
export type {
  ProgramConfig,
  ProgramId,
  ProgramReadyContext,
  ProgramRunStep,
} from '@programs/contract';
export type { FrameworkConfig, SetupQuestion } from '@programs/contract';
export type { ProgramRun } from '@programs/contract';
export type { ProgramSession } from '@programs/contract';
export type { CiRunnerContext, RunnerContext } from '@programs/contract';
export type {
  ProgramDiagnostic,
  ProgramInput,
  ProgramOptions,
  ProgramProgress,
  ProgramRunOutcome,
  ProgramStep,
  ProgramWorkflowConnector,
} from './runner/program-input';
export type { WizardFlagSnapshot } from '@services/session';
export type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from '@shared/credentials';
export type { ApiKeyLoginOptions } from './runner/api-key-login';
export type { OAuthTokenResponse } from '@shared/oauth-tokens';
export type { SessionArgs, WizardSession } from '@services/session';
export type { PlannedEvent, SessionLogin, TaskItem } from '@services/session';
export type { DetectedSource } from '@services/warehouse-sources';
export type { TaskStreamOutcome } from '@services/session';
export type { TaskStreamPushOptions } from '@services/session';
