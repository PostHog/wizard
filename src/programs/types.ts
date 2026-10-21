/** Public type entry for the programs surface. */
export type { SubcommandProgram } from './program-registry';
export type {
  ProgramConfig,
  ProgramId,
  ProgramReadyContext,
  ProgramRunStep,
} from '@services/program-contract';
export type {
  FrameworkConfig,
  SetupQuestion,
} from '@services/program-contract';
export type { ProgramRun } from '@services/program-contract';
export type { ProgramSession } from '@services/program-contract';
export type {
  CiRunnerContext,
  RunnerContext,
} from '@services/program-contract';
export type {
  ProgramDiagnostic,
  ProgramInput,
  ProgramOptions,
  ProgramProgress,
  ProgramRunOutcome,
  ProgramStep,
  ProgramWorkflowConnector,
  WizardFlagSnapshot,
} from '@services/program-contract';
export type {
  CredentialsProvider,
  ResolvedProgramCredentials,
} from '@shared/credentials';
export type { ApiKeyLoginOptions } from './api-key-login';
export type { OAuthTokenResponse } from '@shared/oauth-tokens';
export type { SessionArgs, WizardSession } from '@services/session';
export type { PlannedEvent, SessionLogin, TaskItem } from '@services/session';
export type { DetectedSource } from '@services/warehouse-sources';
export type { TaskStreamOutcome } from '@services/session';
export type { TaskStreamPushOptions } from '@services/session';
