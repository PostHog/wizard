/**
 * Slack connect program — TUI-only flow invoked by `wizard slack`. One
 * step: the same Connect Slack screen the MCP flows end on. The screen
 * renders the no-creds nudge (marketing copy + "Open Slack setup" link);
 * we deliberately don't force OAuth here because connecting Slack itself
 * happens in the browser, so a wizard login adds nothing for the user.
 */

import type { ProgramConfig } from '@lib/programs/program-step';

export const slackConnectConfig: ProgramConfig = {
  id: 'slack',
  description: 'Connect PostHog to your Slack',
  steps: [
    {
      id: 'slack-connect',
      label: 'Connect Slack',
      screenId: 'slack-connect',
      isComplete: (s) => s.slackStepDismissed,
    },
  ],
};
