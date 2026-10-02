/** Public type entry for the programs surface. */
export type { ProgramId, SubcommandProgram } from './program-registry';
export type {
  ProgramConfig,
  ProgramStep,
  ProgramReadyContext,
} from './program-step';
export type { StoreInitContext } from '@tui/flow';
export type { FrameworkConfig, SetupQuestion } from './framework-config';
export type { CiRunnerContext, RunnerContext } from './runner-context';
export type {
  ProgramInput,
  ProgramOptions,
  ProgramOverrides,
  ProgramRunOutcome,
  ProgramSettings,
  WizardFlagSnapshot,
} from './run-program';
export type {
  ProgramDataProgress,
  ProgramDiagnostic,
  ProgramInvocationData,
  ProgramProgress,
  ProgramRunProgress,
  SettledProgramRun,
} from './program-store';
