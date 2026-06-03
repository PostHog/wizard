import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../../audit/slides/shared.js';

const SessionReplayOptimizeVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">{'sampling rate      '}</Text>
      <Text dimColor>{'100% \u2192 ?  '}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'recording triggers '}</Text>
      <Text dimColor>{'event / URL / flag'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'network filtering  '}</Text>
      <Text dimColor>{'noisy?    '}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'mobile sampling    '}</Text>
      <Text dimColor>{'separate? '}</Text>
    </Text>
  </VisualBox>
);

export const SessionReplayOptimizeSlide: AreaSlide = {
  area: 'Session Replay \u2014 Optimize',
  intro: [
    'Cost side of replay — making sure you only pay to record the sessions that actually inform the team.',
    'Looking at sampling rate, recording triggers (event / URL / feature flag), network payload filtering, and per-platform sampling on mobile. Each one is a lever for keeping replay volume in check.',
    'These checks read your PostHog project settings via MCP when available; locally they show as `mcp_skipped: true`.',
  ],
  visual: <SessionReplayOptimizeVisual />,
  docsUrl:
    'https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record',
};
