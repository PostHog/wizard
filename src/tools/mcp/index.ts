/**
 * The MCP tools: `wizard mcp add`, `mcp remove` and `mcp tutorial`. None runs
 * a program. Their screens live in `src/tui/tools/mcp`; the tutorial's prompts
 * stream through `runMcpPrompt`, and `console.ts` installs and removes the
 * server with no screens.
 */

import { streamMcpPrompt } from '@agent';
import type { McpPromptChunk } from '@agent/types';
import type { Credentials } from '@shared/api';
import type { ToolConfig } from '../types';

/** One streamed event of a tutorial prompt run: text, a tool call or result, an error, or done. */
export type { McpPromptChunk };

export const MCP_ADD: ToolConfig = {
  id: 'mcp-add',
  command: 'add',
  parentCommand: 'mcp',
  description: 'Add PostHog MCP server to supported clients',
};

export const MCP_REMOVE: ToolConfig = {
  id: 'mcp-remove',
  command: 'remove',
  parentCommand: 'mcp',
  description: 'Remove PostHog MCP server from supported clients',
};

/**
 * The tutorial with no install first: for users who already installed MCP,
 * or who want to try the agent against PostHog without touching their IDE
 * config. Its screen logs in on its own.
 */
export const MCP_TUTORIAL: ToolConfig = {
  id: 'mcp-tutorial',
  command: 'tutorial',
  parentCommand: 'mcp',
  description: 'Try the PostHog MCP with your agent — no install needed',
};

/**
 * Run one tutorial prompt against the PostHog MCP server and stream what the
 * agent says and calls. The suggested-prompts screen consumes it; only
 * PostHog MCP tools are allowed, and `resumeSessionId` continues an earlier
 * turn's conversation. `programId` attributes the gateway spend.
 */
export function runMcpPrompt(args: {
  prompt: string;
  credentials: Credentials;
  signal: AbortSignal;
  resumeSessionId?: string;
  programId?: string;
  integration?: string;
}): AsyncIterable<McpPromptChunk> {
  return streamMcpPrompt(args);
}
