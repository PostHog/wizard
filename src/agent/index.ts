/**
 * Public entry of the agent. Code outside `src/agent` imports runtime values
 * from here and types from `./types`; deeper imports fail lint and the
 * architecture test. Keep this list to what callers use, and keep it cheap:
 * the startup chunk imports this module, so anything re-exported here loads
 * before the wizard does any work. Heavy paths stay behind a lazy import.
 *
 * Grouped by fate, per the stack plan (sections 4.1 to 4.5 and 7).
 */

/**
 * Stays. The agent's contract: the one way to run it, the marker strings
 * program prompts embed, the tool ids programs put in allowedTools and
 * disallowedTools, and what programs resolve a binding with: the default
 * binding, the harness axis and each harness's task capability.
 */
export type * from './types';
export { runAgent, RunOutcome } from './runner';
export { AgentSignals } from './agent-interface';
export { WIZARD_TOOL_NAMES } from './tools';
export { DEFAULT_AGENT_BINDING } from './default-binding';
export {
  harnessRunsTasks,
  resolveHarness,
} from './runner/switchboard/resolve-harness';

/**
 * Leaves in B2. shouldDisableAsk is a flags policy programs decide and pass
 * in; LONGER_ASK_TIMEOUT_MS is a tuning number programs own as askTimeoutMs.
 */
export { shouldDisableAsk } from './runner';
export { LONGER_ASK_TIMEOUT_MS } from './wizard-ask-bridge';

/**
 * Leaves in B2. Programs own credentials and the legacy adapter dies.
 * initializeAgent, executeAgent and buildRunTags are the pre-runAgent surface
 * that detection/agentic.ts and run-program-agent.ts still call; they go
 * through runAgent or leave with detection, and AgentErrorType, which
 * classifies executeAgent's failures, goes with them.
 * configureGatewayFromCIEnvironment is CI inference auth the headless provider
 * owns. flushScanReport becomes a progress event rather than a call.
 * downloadSkill leaves once the skill scan runs at load and skill install
 * becomes shared.
 */
export {
  AgentErrorType,
  buildRunTags,
  initializeAgent,
  runAgent as executeAgent,
} from './agent-interface';
export { configureGatewayFromCIEnvironment } from './gateway-session';
export { flushScanReport } from './yara-hooks';
export { downloadSkill } from './tools';
/** The frameworkContext slot the legacy adapter fills for the e2e harness. */
export { TASK_OUTCOMES_KEY } from './runner';

/**
 * Leaves in C2. The TUI receives agent data through program state. Until
 * then the suggested-prompts screen streams through this wrapper, which loads
 * the streaming module on first call so the startup chunk does not grow.
 */
export async function* runMcpPromptViaSdk(
  args: Parameters<
    typeof import('./mcp-prompt-streaming').runMcpPromptViaSdk
  >[0],
): AsyncIterable<import('./types').AgentChunk> {
  const streaming = await import('./mcp-prompt-streaming');
  yield* streaming.runMcpPromptViaSdk(args);
}
