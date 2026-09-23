/**
 * MCP add / remove / tutorial flows. None of these programs runs an agent;
 * the flows are the whole program.
 */

import { McpOutcome } from '@shared/run/run-state';
import type { FlowStep } from './flow';

/**
 * Order: install → Slack → tutorial. Slack runs before the tutorial
 * because it renders gracefully without credentials (no surprise
 * OAuth on the loginless install path). The tutorial is last so its
 * explicit "Start tutorial" opt-in is the moment OAuth fires — and
 * skipping the tutorial doesn't bury Slack discovery behind a
 * dismissal screen.
 */
export const MCP_ADD_FLOW: FlowStep[] = [
  {
    id: 'mcp-add',
    label: 'Add MCP server',
    screenId: 'mcp-add',
    isComplete: (s) => s.mcpComplete,
  },
  {
    id: 'slack-connect',
    label: 'Connect Slack',
    screenId: 'slack-connect',
    // Gate on a successful install so no-clients / skipped / failed
    // outcomes go straight to program end without a "what's next" prompt.
    show: (s) => s.mcpOutcome === McpOutcome.Installed,
    isComplete: (s) => s.slackStepDismissed,
  },
  {
    id: 'mcp-suggested-prompts',
    label: 'Suggested prompts',
    screenId: 'mcp-suggested-prompts',
    // Same install gate — without a working MCP there's nothing to
    // talk to from the tutorial.
    show: (s) => s.mcpOutcome === McpOutcome.Installed,
    isComplete: (s) => s.mcpSuggestedPromptsDismissed,
    // This step *is* the tutorial, so it reports there rather than to
    // `mcp-add`. Literal avoids a runtime cycle with the program registry;
    // the `ProgramId` type still catches a rename.
    reportsAsProgramId: 'mcp-tutorial',
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
 * a screen earlier in this program — don't reuse the tutorial.
 */
export const MCP_REMOVE_FLOW: FlowStep[] = [
  {
    id: 'mcp-remove',
    label: 'Remove MCP server',
    screenId: 'mcp-remove',
    isComplete: (s) => s.mcpComplete,
  },
];

export const MCP_TUTORIAL_FLOW: FlowStep[] = [
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
];
