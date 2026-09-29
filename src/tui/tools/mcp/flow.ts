import type { FlowStep } from '@tui/flow';
import { McpOutcome } from '@shared/run-state';

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
