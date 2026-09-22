/**
 * Public entry of the agent. Code outside `src/agent` imports runtime values
 * from here and types from `./types`; deeper imports fail lint and the
 * architecture test. Keep this list to what callers use, and keep it cheap:
 * the startup chunk imports this module, so anything re-exported here loads
 * before the wizard does any work. Heavy paths stay behind a lazy import.
 *
 * Audited against the stack plan (docs: workbench/wizard-functional-stack-plan.md,
 * sections 4.1 to 4.5 and 7). What stays and what leaves:
 *
 * Final, the agent's contract:
 *   runAgent, RunOutcome           the one way to run the agent (4.1)
 *   AgentSignals                   prompt marker strings program prompts embed
 *   WIZARD_TOOL_NAMES              tool ids programs put in allowedTools/disallowedTools
 *
 * Leaves in B1 (bindings and program data move to programs, 4.5):
 *   resolveBinding                 keyed by PROGRAM_BINDINGS; agent keeps only
 *                                  "run from an already-resolved binding"
 *   shouldDisableAsk               a flags policy programs decide, then pass in
 *   LONGER_ASK_TIMEOUT_MS          a tuning number; programs own askTimeoutMs
 *
 * Leaves in B2 (programs own credentials and the legacy adapter dies):
 *   initializeAgent, executeAgent, buildRunTags
 *                                  the pre-runAgent surface detection/agentic.ts
 *                                  and run-agent-legacy.ts still call; they go
 *                                  through runAgent or leave with detection
 *   configureGatewayFromCIEnvironment
 *                                  CI inference auth; headless provider owns it
 *   flushScanReport                the report becomes a progress event, not a call
 *
 * Leaves in A4 (scan at load; skill install becomes shared):
 *   downloadSkill
 *
 * Leaves in C2 (the TUI receives agent data through program state):
 *   runMcpPromptViaSdk
 */
export type * from './types';
export {
  resolveBinding,
  runAgent,
  RunOutcome,
  shouldDisableAsk,
} from './runner';
export {
  AgentSignals,
  buildRunTags,
  initializeAgent,
  runAgent as executeAgent,
} from './agent-interface';
// TODO(B2): leaves the entry when the headless provider owns CI gateway auth.
export { configureGatewayFromCIEnvironment } from './gateway-session';
export { downloadSkill, WIZARD_TOOL_NAMES } from './tools';
export { LONGER_ASK_TIMEOUT_MS } from './wizard-ask-bridge';
export { flushScanReport } from './yara-hooks';

/**
 * Stream an MCP tutorial prompt through the SDK. Loaded on first call: the
 * streaming module is the one agent module the startup chunk does not already
 * hold, and the TUI reaches it only from the suggested-prompts screen.
 */
export async function* runMcpPromptViaSdk(
  args: Parameters<
    typeof import('./mcp-prompt-streaming').runMcpPromptViaSdk
  >[0],
): AsyncIterable<import('./types').AgentChunk> {
  const streaming = await import('./mcp-prompt-streaming');
  yield* streaming.runMcpPromptViaSdk(args);
}
