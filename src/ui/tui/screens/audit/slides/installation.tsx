import { Text } from 'ink';
import { VisualBox, type AreaSlide } from './shared.js';

const InstallationVisual = () => (
  <VisualBox>
    <Text dimColor>app boot</Text>
    <Text>
      <Text dimColor>{'  ▼ '}</Text>
      <Text color="green">posthog.init(...)</Text>
      <Text dimColor>{'   once'}</Text>
    </Text>
    <Text dimColor>{'  │'}</Text>
    <Text>
      <Text dimColor>{'  ▼ '}</Text>
      <Text color="cyan">posthog.capture('pageview')</Text>
    </Text>
    <Text>
      <Text dimColor>{'    '}</Text>
      <Text color="cyan">posthog.capture('signup')</Text>
    </Text>
    <Text>
      <Text dimColor>{'    '}</Text>
      <Text color="cyan">posthog.capture('purchase')</Text>
    </Text>
  </VisualBox>
);

export const InstallationSlide: AreaSlide = {
  area: 'Installation',
  intro: [
    "PostHog releases frequent SDK updates to fix bugs and add new features. We're checking your project's SDK version and making sure it's up to date.",
    "We're also checking that your SDK is initialized correctly and in the right part of your app's lifecycle.",
    "This ensures you won't miss any autocaptured events.",
  ],
  visual: <InstallationVisual />,
  docsUrl: 'https://posthog.com/docs/getting-started/install',
};
