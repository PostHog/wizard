/**
 * Re-export shim. The runner has been split into agent/runner/.
 * Import from there directly; this shim keeps existing importers working.
 * The session-driven `runProgramAgent(programConfig, session)` lives in
 * `src/lib/runners/run-program-agent.ts`.
 */

export {
  runAgent,
  shouldDisableAsk,
  type AgentRunDefinition,
  type BootstrapResult,
  type AbortCase,
  type PromptContext,
  type Credentials,
} from './runner/index';
