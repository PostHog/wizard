/**
 * Re-export shim. The runner has been split into agent/runner/.
 * Import from there directly; this shim keeps existing importers working.
 */

export {
  runAgent,
  runProgram,
  shouldDisableAsk,
  type ProgramRun,
  type BootstrapResult,
  type AbortCase,
  type PromptContext,
  type Credentials,
} from './runner/index';
