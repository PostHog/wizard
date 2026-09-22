/** Public type entry for the programs surface. */
export type { ProgramId, SubcommandProgram } from './program-registry';
export type {
  ProgramConfig,
  ProgramStep,
  ProgramReadyContext,
  StoreInitContext,
} from './program-step';
export type { ProgramCompletionContext } from './program-run';
export type { FrameworkConfig, SetupQuestion } from './framework-config';
export type { ProgramCiHost, ProgramRunHost } from './host-capabilities';
export type {
  ProgramInput,
  ProgramOptions,
  ProgramRunOutcome,
  ProgramWorkflowConnector,
} from './run-program';
export type {
  ProgramInvocationData,
  ProgramProgress,
  ProgramStoreProjection,
  SettledProgramRun,
} from './program-store';
export type {
  ProgramBinding,
  ProgramSwitchboardCtx,
  ProgramSwitchboardTrace,
} from './binding';
