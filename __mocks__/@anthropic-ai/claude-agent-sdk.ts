// Mock for @anthropic-ai/claude-agent-sdk

export type SDKMessage =
  | {
      type: 'assistant';
      message?: { content?: Array<{ type: string; text?: string }> };
    }
  | { type: 'result'; subtype: 'success'; result?: string }
  | { type: 'result'; subtype: string; errors?: string[] }
  | {
      type: 'system';
      subtype: 'init';
      model?: string;
      tools?: string[];
      mcp_servers?: unknown[];
    }
  | { type: string };

export type Options = {
  model?: string;
  cwd?: string;
  permissionMode?: string;
  mcpServers?: Record<string, unknown>;
  canUseTool?: (toolName: string, input: unknown) => Promise<unknown>;
  tools?: { type: string; preset: string };
  systemPrompt?: { type: string; preset: string };
};

export type QueryInput = {
  prompt: string;
  options?: Options;
};

// Mock generator that yields a success result
function* mockQueryGenerator(): Generator<SDKMessage, void> {
  yield {
    type: 'system',
    subtype: 'init',
    model: 'claude-opus-4-5-20251101',
    tools: [],
    mcp_servers: [],
  };
  yield {
    type: 'result',
    subtype: 'success',
    result: 'Mock agent completed successfully',
  };
}

export function query(_input: QueryInput): Generator<SDKMessage, void> {
  return mockQueryGenerator();
}
