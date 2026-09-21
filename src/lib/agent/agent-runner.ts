/**
 * Re-export shim. The runner has been split into agent/runner/.
 * Import from there directly; this shim keeps existing importers working.
 * The session-driven `runAgent(programConfig, session)` lives in
 * `src/lib/programs/run-agent-legacy.ts`.
 */

export {
  runAgent,
  shouldDisableAsk,
  type ProgramRun,
  type BootstrapResult,
  type AbortCase,
  type PromptContext,
  type Credentials,
} from './runner/index';
