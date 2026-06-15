/**
 * MCP add / remove / tutorial programs.
 *
 * None of these run the agent pipeline — they're TUI-only flows invoked
 * by the `mcp add` / `mcp remove` / `mcp tutorial` subcommands in
 * bin.ts. They live in the program registry so the screen sequence is
 * derived alongside every other program (no special-cases in
 * screen-sequences.ts).
 */

import type { ProgramConfig } from '@lib/programs/program-step';
import { McpOutcome } from '@lib/wizard-session';

export const mcpAddConfig: ProgramConfig = {
  id: 'mcp-add',
  requiresAi: false,
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
    {
      id: 'slack-connect',
      label: 'Connect Slack',
      screenId: 'slack-connect',
      // Gate on the same successful-install signal as the tutorial step,
      // so the "what's next" Slack prompt only appears once the user has
      // a working MCP. No-clients / skipped / failed installs end here.
      show: (s) => s.mcpOutcome === McpOutcome.Installed,
      isComplete: (s) => s.slackStepDismissed,
    },
  ],
};

/**
 * `wizard mcp remove` — single-step uninstall flow.
 *
 * DO NOT append `mcp-suggested-prompts` (or any other tutorial-shaped
 * step) here. A user who just removed MCP is opting OUT of the agent
 * having access to PostHog; immediately pivoting into a tutorial that
 * asks them to log in and try prompts is wrong on intent and confusing
 * on UX. The screen also reads `session.mcpInstalledClients` for its
 * Choose-phase copy ("MCP is installed for X") — that array is empty
 * post-remove, so the copy would be a lie.
 *
 * If you want a "did you mean to keep it?" confirmation, build that as
 * a screen earlier in this program — don't reuse the tutorial.
 */
export const mcpRemoveConfig: ProgramConfig = {
  id: 'mcp-remove',
  requiresAi: false,
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
  steps: [
    {
      id: 'mcp-suggested-prompts',
      label: 'MCP tutorial',
      screenId: 'mcp-suggested-prompts',
      isComplete: (s) => s.mcpSuggestedPromptsDismissed,
    },
    {
      id: 'slack-connect',
      label: 'Connect Slack',
      screenId: 'slack-connect',
      isComplete: (s) => s.slackStepDismissed,
    },
  ],
};
