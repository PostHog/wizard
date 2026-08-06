import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const ObservabilityVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">evaluate flag</Text>
      <Text dimColor>{'  ✓ your app got a value'}</Text>
    </Text>
    <Text>
      <Text color="cyan">report it</Text>
      <Text dimColor>{'     '}</Text>
      <Text color="yellow">$feature_flag_called?</Text>
    </Text>
    <Text dimColor>{'  └─ different things. experiments +'}</Text>
    <Text dimColor>{'     staleness both live on the 2nd'}</Text>
  </VisualBox>
);

export const FlagObservabilitySlide: AreaSlide = {
  area: 'Feature Flags — Observability',
  intro: [
    'Evaluating a flag and reporting that it was evaluated are different things. SDKs report evaluations as $feature_flag_called events — experiments use them for exposure, and PostHog measures flag staleness from them.',
    'If those events are suppressed, a heavily-used flag looks stale — and archiving it would turn off a live feature. That is why the doctor verifies reporting is flowing before it will offer any cleanup.',
  ],
  visual: <ObservabilityVisual />,
  docsUrl: 'https://posthog.com/docs/experiments/exposures',
};
