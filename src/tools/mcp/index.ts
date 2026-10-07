/**
 * The MCP tools: `wizard mcp add`, `mcp remove` and `mcp tutorial`. None runs
 * a program. Their screens live in `src/tui/tools/mcp`; the tutorial's prompts
 * stream through the agent's `streamMcpPrompt`, and `console.ts` installs and
 * removes the server with no screens.
 */

import type { ToolConfig } from '../types';

export { streamMcpPrompt } from '@agent';
export type { McpPromptChunk } from '@agent/types';

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
 * Standalone tutorial flow — boots directly into the Choose phase of
 * McpSuggestedPromptsScreen without going through MCP install first.
 * Useful for users who already installed MCP and want to revisit the
 * tutorial, or anyone who just wants to try the agent against PostHog
 * without touching their IDE config.
 *
 * The screen handles its own OAuth (via services.performLogin) so this
 * tool doesn't pre-populate credentials.
 */
export const MCP_TUTORIAL: ToolConfig = {
  id: 'mcp-tutorial',
  command: 'tutorial',
  parentCommand: 'mcp',
  description: 'Try the PostHog MCP with your agent — no install needed',
};
