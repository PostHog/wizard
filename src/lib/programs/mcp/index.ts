/**
 * MCP add/remove programs.
 *
 * These don't run the agent pipeline — they're TUI-only flows invoked
 * by the `mcp add` / `mcp remove` subcommands in bin.ts. They live in
 * the program registry so the screen sequence is derived alongside
 * every other program (no special-cases in screen-sequences.ts).
 */

import type { ProgramConfig } from '@lib/programs/program-step';
import { McpOutcome } from '@lib/wizard-session';

export const mcpAddConfig: ProgramConfig = {
  id: 'mcp-add',
  description: 'Add PostHog MCP server to supported clients',
  steps: [
    {
      id: 'mcp-add',
      label: 'Add MCP server',
      screenId: 'mcp-add',
      isComplete: (s) => s.mcpComplete,
    },
    {
      id: 'mcp-suggested-prompts',
      label: 'Suggested prompts',
      screenId: 'mcp-suggested-prompts',
      // Only render after a successful install — no-clients, skipped,
      // and failed outcomes go straight to program end. The screen has
      // no value without a working MCP for the user to log in against.
      show: (s) => s.mcpOutcome === McpOutcome.Installed,
      isComplete: (s) => s.mcpSuggestedPromptsDismissed,
    },
  ],
};

export const mcpRemoveConfig: ProgramConfig = {
  id: 'mcp-remove',
  description: 'Remove PostHog MCP server from supported clients',
  steps: [
    {
      id: 'mcp-remove',
      label: 'Remove MCP server',
      screenId: 'mcp-remove',
      isComplete: (s) => s.mcpComplete,
    },
  ],
};
