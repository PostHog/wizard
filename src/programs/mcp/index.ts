/**
 * MCP add / remove / tutorial programs.
 *
 * None of these run the agent pipeline; their flows (`src/tui/flows/mcp.ts`)
 * are the whole program, invoked by the `mcp add` / `mcp remove` /
 * `mcp tutorial` subcommands. They live in the program registry so the
 * screen sequence is derived alongside every other program.
 */

import type { ProgramConfig } from '@programs/program-step';

export const mcpAddConfig: ProgramConfig = {
  id: 'mcp-add',
  requiresAi: false,
  description: 'Add PostHog MCP server to supported clients',
};

/** `wizard mcp remove`: uninstall only. See `MCP_REMOVE_FLOW` before adding steps. */
export const mcpRemoveConfig: ProgramConfig = {
  id: 'mcp-remove',
  requiresAi: false,
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
 * program doesn't pre-populate credentials.
 */
export const mcpTutorialConfig: ProgramConfig = {
  id: 'mcp-tutorial',
  requiresAi: false,
  description: 'Try the PostHog MCP with your agent — no install needed',
};
