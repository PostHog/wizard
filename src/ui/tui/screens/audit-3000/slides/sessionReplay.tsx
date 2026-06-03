import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../../audit/slides/shared.js';

const SessionReplayVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">{'min duration       '}</Text>
      <Text color="yellow">{'2000ms?'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'mask inputs        '}</Text>
      <Text color="yellow">{'on?    '}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'CI / test guard    '}</Text>
      <Text color="yellow">{'gated? '}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'strict min         '}</Text>
      <Text color="yellow">{'opt-in?'}</Text>
    </Text>
  </VisualBox>
);

export const SessionReplaySlide: AreaSlide = {
  area: 'Session Replay',
  intro: [
    'Recording correctness — making sure replays capture useful sessions without leaking sensitive data or flooding the pipeline with noise.',
    'Checking that bounce sessions are filtered out (minimumDuration), inputs are masked on sensitive screens, replay is gated in test/CI environments, and strictMinimumDuration is on to future-proof your config.',
    'These are codebase checks against your init call — no PostHog data is queried here.',
  ],
  visual: <SessionReplayVisual />,
  docsUrl:
    'https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record',
};
