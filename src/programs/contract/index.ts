/** The program contract: what a program is and what it runs on. Services and programs both import it. */
export {
  DEFAULT_PACKAGE_INSTALLATION,
  PYTHON_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
  type FrameworkConfig,
  type SetupQuestion,
} from './framework-config';
export type { ProgramRun } from './program-run';
export type { ProgramSession, ScanReport } from './program-session';
export type {
  DecisionQuestionKey,
  ProgramConfig,
  ProgramId,
  ProgramReadyContext,
  ProgramRunStep,
} from './program-step';
export type { CiRunnerContext, RunnerContext } from './runner-context';
