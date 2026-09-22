import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const ScanVisual = () => (
  <VisualBox>
    <Text dimColor>grep -rn 'posthog\.(capture|identify|group)'</Text>
    <Text>
      <Text color="cyan">src/checkout/Checkout.tsx:88</Text>
      <Text dimColor>{'  posthog.capture(...)'}</Text>
    </Text>
    <Text>
      <Text color="cyan">src/auth/login.ts:42</Text>
      <Text dimColor>{'        posthog.identify(...)'}</Text>
    </Text>
    <Text>
      <Text color="cyan">src/onboarding/step.tsx:17</Text>
      <Text dimColor>{'  posthog.capture(...)'}</Text>
    </Text>
  </VisualBox>
);

export const ScanSitesSlide: AreaSlide = {
  area: 'Scan capture sites',
  intro: [
    'Next we map every place your code captures PostHog events. This is the inventory the rest of the audit builds on.',
    'We search your project for PostHog SDK calls: capture, identify, group, and more. No source files are opened yet, that comes in the next step.',
    "Test files are excluded so they don't pollute the inventory.",
  ],
  visual: <ScanVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/capture-events',
};
