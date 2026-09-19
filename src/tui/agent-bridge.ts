import type {
  AgentChunk,
  McpPromptRequest,
} from '@store/agent-protocol/mcp-prompt';

/** Agent work the TUI needs; the entry point installs the agent surface's implementation. */
export interface TuiAgentBridge {
  runMcpPrompt(args: McpPromptRequest): AsyncIterable<AgentChunk>;
}

let bridge: TuiAgentBridge | null = null;

export function setAgentBridge(next: TuiAgentBridge): void {
  bridge = next;
}

export function getAgentBridge(): TuiAgentBridge {
  if (!bridge) throw new Error('agent bridge not installed');
  return bridge;
}
