import type { FlowStep } from '@tui/flow';

export const SLACK_FLOW: FlowStep[] = [
  {
    id: 'slack-connect',
    label: 'Connect Slack',
    screenId: 'slack-connect',
    isComplete: (s) => s.slackStepDismissed,
  },
];
