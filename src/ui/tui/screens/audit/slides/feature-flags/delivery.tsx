import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const DeliveryVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">POST /flags</Text>
      <Text dimColor>{'  with your project key'}</Text>
    </Text>
    <Text>
      <Text dimColor>{'  ▼ '}</Text>
      <Text color="green">200</Text>
      <Text dimColor>{'  { flags: {} }  ← but why?'}</Text>
    </Text>
    <Text dimColor>{'  key not loaded? proxy broken?'}</Text>
    <Text dimColor>{'  nothing configured? filtered client?'}</Text>
  </VisualBox>
);

export const FlagDeliverySlide: AreaSlide = {
  area: 'Feature Flags — Delivery',
  intro: [
    'A misconfigured flag does not throw an error — the app quietly serves defaults while the dashboard says everything is active. An empty flags response looks identical across several unrelated causes.',
    "We're evaluating your flags through the real /flags endpoint, with your project's own key, via the same path your app uses — and cross-checking what comes back against your flag definitions. Every flag key referenced in code is also checked against what actually exists in PostHog.",
    'If something is not arriving, the report names which cause you are hitting.',
  ],
  visual: <DeliveryVisual />,
  docsUrl: 'https://posthog.com/docs/feature-flags/troubleshooting',
};
