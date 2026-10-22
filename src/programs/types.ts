/** Public type entry for the programs surface. */
export type { SubcommandProgram } from './program-runner/program-registry';
export type {
  ProgramConfig,
  ProgramId,
  ProgramReadyContext,
  ProgramRunStep,
} from '@programs/program-contract';
export type {
  FrameworkConfig,
  SetupQuestion,
} from '@programs/program-contract';
export type { ProgramRun } from '@programs/program-contract';
export type { ProgramSession } from '@programs/program-contract';
export type {
  CiRunnerContext,
  RunnerContext,
} from '@programs/program-contract';
export type {
  ProgramDiagnostic,
  ProgramInput,
  ProgramOptions,
  ProgramProgress,
  ProgramRunOutcome,
  ProgramStep,
  ProgramWorkflowConnector,
} from './program-runner/program-input';
export type { WizardFlagSnapshot } from '@services/session';
export type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from '@shared/credentials';
export type { ApiKeyLoginOptions } from './program-runner/api-key-login';
export type { OAuthTokenResponse } from '@shared/oauth-tokens';
export type { SessionArgs, WizardSession } from '@services/session';
export type { PlannedEvent, SessionLogin, TaskItem } from '@services/session';
export type { DetectedSource } from '@services/warehouse-sources';
export type { TaskStreamOutcome } from '@services/session';
export type { TaskStreamPushOptions } from '@services/session';
