/** Shape of the agent surface. Type-only re-exports keep it free of runtime imports. */
import type { runAgent } from './runner/index.js';

/** One independent agent run. */
export type RunAgent = typeof runAgent;
export type { BootstrapResult } from './runner/shared/types.js';
export type {
  AgentHarness,
  AgentResult,
  BackendRunInputs,
  RunMiddleware,
  TaskRunInputs,
} from './runner/harness/types.js';
export type {
  HarnessPick,
  ProgramBinding,
  SwitchboardCtx,
  SwitchboardTrace,
} from './runner/switchboard/index.js';
