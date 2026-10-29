/** The program contract: what a program is and what it runs on. Services and programs both import it. */
export {
  DEFAULT_PACKAGE_INSTALLATION,
  PYTHON_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
  type FrameworkConfig,
  type SetupQuestion,
} from './framework-config';
export { ProgramAbort } from './program-abort';
export type { ProgramRun } from './program-run';
export type { ProgramSession, ScanReport } from './program-session';
export type {
  ProjectTraits,
  Trait,
  TraitName,
  TraitSource,
} from './project-traits';
export {
  defineFlow,
  resolveFlow,
  type Flow,
  type FlowContext,
  type FlowNode,
} from './flow';
export type {
  DecisionQuestionKey,
  ProgramConfig,
  ProgramId,
  ProgramReadyContext,
  ProgramRunStep,
} from './program-step';
export type { CiRunnerContext, RunnerContext } from './runner-context';
