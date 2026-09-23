import type { FlowStep } from '../flow';

/** `wizard slack`: the Connect Slack screen the MCP flows end on. */
export const SLACK_CONNECT_FLOW: FlowStep[] = [
  {
    id: 'slack-connect',
    label: 'Connect Slack',
    screenId: 'slack-connect',
    isComplete: (s) => s.slackStepDismissed,
  },
];
