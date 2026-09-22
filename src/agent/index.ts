/**
 * Public entry of the agent. Code outside `src/agent` imports runtime values
 * from here and types from `./types`; deeper imports fail lint and the
 * architecture test. Keep this list to what callers use, and keep it cheap:
 * the startup chunk imports this module, so anything re-exported here loads
 * before the wizard does any work. Heavy paths stay behind a lazy import.
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
