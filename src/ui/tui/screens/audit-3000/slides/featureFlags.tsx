import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../../audit/slides/shared.js';

const FeatureFlagsVisual = () => (
  <VisualBox>
    <Text>
      <Text color="red">{'new-checkout-v2    '}</Text>
      <Text dimColor>{'no code refs   '}</Text>
      <Text color="red">{'DROP'}</Text>
    </Text>
    <Text>
      <Text color="yellow">{'beta-dashboard     '}</Text>
      <Text dimColor>{'1 ref, 100% on '}</Text>
      <Text color="yellow">{'REVIEW'}</Text>
    </Text>
    <Text>
      <Text color="green">{'killswitch-payments'}</Text>
      <Text dimColor>{'live experiment'}</Text>
      <Text color="green">{'KEEP'}</Text>
    </Text>
  </VisualBox>
);

export const FeatureFlagsSlide: AreaSlide = {
  area: 'Feature Flags',
  intro: [
    'LEVEL 6: STALE FLAGS. Old flags add evaluation overhead and confuse the next engineer who wonders if a flag is still live.',
    "Cross-referencing PostHog's stale-flag classification against your source tree. Each flag scored: safe-to-disable, needs-review, or unknown.",
    'The final report ships with a copy-paste cleanup prompt. We never touch a flag.',
  ],
  visual: <FeatureFlagsVisual />,
  docsUrl: 'https://posthog.com/docs/feature-flags',
};
