import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const CorrectnessVisual = () => (
  <VisualBox>
    <Text dimColor>page load</Text>
    <Text>
      <Text dimColor>{'  ▼ '}</Text>
      <Text color="cyan">isFeatureEnabled('beta')</Text>
      <Text dimColor>{'  → '}</Text>
      <Text color="yellow">undefined</Text>
      <Text dimColor>{'  (still loading)'}</Text>
    </Text>
    <Text dimColor>{'  │  …flags arrive…'}</Text>
    <Text>
      <Text dimColor>{'  ▼ '}</Text>
      <Text color="cyan">isFeatureEnabled('beta')</Text>
      <Text dimColor>{'  → '}</Text>
      <Text color="green">true</Text>
    </Text>
  </VisualBox>
);

export const FlagCorrectnessSlide: AreaSlide = {
  area: 'Feature Flags',
  intro: [
    'Client-side flags load asynchronously — a flag evaluated before the SDK is ready returns undefined, and undefined is not false.',
    "We're checking every flag call site for the classic traps: evaluating during the loading window, missing default values, bootstrap mismatches, and flags evaluated before identify() resolves the real user.",
    'Each of these fails silently — the app just renders the wrong thing with no error anywhere.',
  ],
  visual: <CorrectnessVisual />,
  docsUrl: 'https://posthog.com/docs/feature-flags/best-practices',
};
