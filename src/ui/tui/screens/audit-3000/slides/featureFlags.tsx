import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '@ui/tui/screens/audit/slides/shared';

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
    "Old flags that are no longer in use still get evaluated on every flag call and clutter the dashboard — they're the silent compounding noise of a long-running PostHog project.",
    "Cross-referencing PostHog's stale-flag list against your source tree. Each flag is scored as safe-to-disable, needs-review, or unknown.",
    'The notebook ships with a copy-paste cleanup prompt so you can disable the safe ones from any PostHog MCP-enabled chat — we never touch a flag automatically.',
  ],
  visual: <FeatureFlagsVisual />,
  docsUrl: 'https://posthog.com/docs/feature-flags',
};
