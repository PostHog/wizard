/**
 * Re-export shim for the agent runner. Import from `./runner/index` directly;
 * this shim keeps existing importers of the agent's types working.
 *
 * The session-driven `runAgent(programConfig, session)` every runner and
 * program used to import from here now lives in
 * `src/lib/programs/run-agent-legacy.ts`.
 */

export {
  runAgent,
  shouldDisableAsk,
  type AbortCase,
  type AgentFailure,
  type AgentInteraction,
  type AgentProgress,
  type AgentRunDefinition,
  type BootstrapResult,
  type Credentials,
  type PromptContext,
  type RunAgentOptions,
  type RunConfig,
  type RunInput,
  type RunResult,
} from './runner/index';
