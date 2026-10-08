import type { FlowStep } from '@tui/flow';

export const MCP_ADD_FLOW: FlowStep[] = [
  // One step: the install screen's results double as the success screen. The
  // tutorial stays opt-in via `wizard mcp tutorial`, so no surprise login.
  {
    id: 'mcp-add',
    label: 'Add MCP server',
    screenId: 'mcp-add',
    isComplete: (s) => s.mcpComplete,
  },
];

/**
 * `wizard mcp remove` — single-step uninstall flow.
 *
 * DO NOT append `mcp-suggested-prompts` (or any other tutorial-shaped
 * step) here. A user who just removed MCP is opting OUT of the agent having
 * access to PostHog; immediately pivoting into a tutorial that asks
 * them to log in and try prompts is wrong on intent and confusing on
 * UX. The screen also reads `session.mcpInstalledClients` for its
 * Choose-phase copy ("MCP is installed for X") — that array is empty
 * post-remove, so the copy would be a lie.
 *
 * If you want a "did you mean to keep it?" confirmation, build that as
 * a screen earlier in this flow — don't reuse the tutorial.
 */
export const MCP_REMOVE_FLOW: FlowStep[] = [
  {
    id: 'mcp-remove',
    label: 'Remove MCP server',
    screenId: 'mcp-remove',
    isComplete: (s) => s.mcpComplete,
  },
];

/**
 * Standalone tutorial flow — boots directly into the Choose phase of
 * McpSuggestedPromptsScreen without going through MCP install first.
 * Useful for users who already installed MCP and want to revisit the
 * tutorial, or anyone who just wants to try the agent against PostHog
 * without touching their IDE config.
 *
 * The screen handles its own OAuth (via services.performLogin) so this
 * flow doesn't pre-populate credentials.
 */
export const MCP_TUTORIAL_FLOW: FlowStep[] = [
  {
    id: 'mcp-suggested-prompts',
    label: 'MCP tutorial',
    screenId: 'mcp-suggested-prompts',
    isComplete: (s) => s.mcpSuggestedPromptsDismissed,
  },
];
