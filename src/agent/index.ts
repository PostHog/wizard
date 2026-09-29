/**
 * Public entry of the agent. Code outside `src/agent` imports runtime values
 * from here and types from `./types`; deeper imports fail `pnpm typecheck`.
 * Keep this list to what callers use, and keep it cheap:
 * the startup chunk imports this module, so anything re-exported here loads
 * before the wizard does any work. Heavy paths stay behind a lazy import.
 */

/**
 * The agent's contract: the one way to run it, the marker strings
 * program prompts embed, and the tool ids programs put in allowedTools and
 * disallowedTools.
 */
export type * from './types';
export { runAgent, RunOutcome } from './runner';
export { AgentSignals } from './agent-interface';
export { WIZARD_TOOL_NAMES } from './tools';

/** The binding a program gets when it declares none. */
export { DEFAULT_BINDING } from './runner';

/**
 * The MCP tutorial's prompt stream: one prompt against the PostHog MCP server,
 * streamed as chunks. The MCP tool wraps it as `runMcpPrompt`, and the TUI
 * reaches it only through `@tools`. It loads the streaming module on
 * first call so the startup chunk does not grow.
 */
export async function* streamMcpPrompt(
  args: Parameters<typeof import('./mcp-prompt-streaming').streamMcpPrompt>[0],
): AsyncIterable<import('./types').McpPromptChunk> {
  const streaming = await import('./mcp-prompt-streaming');
  yield* streaming.streamMcpPrompt(args);
}
