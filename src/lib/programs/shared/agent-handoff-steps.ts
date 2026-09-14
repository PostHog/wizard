import type { ProgramStep } from '../program-step';
import type { WizardSession } from '@lib/wizard-session';

// These setup steps remain useful when a user's own agent takes over after a
// mint failure, so both routes into the post-run sequence share them.
export const AGENT_HANDOFF_STEPS: ProgramStep[] = [
  {
    id: 'mcp',
    label: 'MCP servers',
    screenId: 'mcp',
    isComplete: (session) => session.mcpComplete,
  },
  {
    id: 'slack-connect',
    label: 'Connect Slack',
    screenId: 'slack-connect',
    // Always shown — the user declines via Skip/esc, never bypassed.
    isComplete: (session) => session.slackStepDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
    isComplete: (session: WizardSession) => session.skillsComplete,
  },
];
