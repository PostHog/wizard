import { Text } from 'ink';
import { VisualBox, type AreaSlide } from './shared.js';

const CaptureVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">{'pageview   '}</Text>
      <Text color="green">{'████████████'}</Text>
      <Text dimColor>{' 1000'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'signup     '}</Text>
      <Text color="green">{'████████'}</Text>
      <Text dimColor>{'      640'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'activated  '}</Text>
      <Text color="green">{'█████'}</Text>
      <Text dimColor>{'         410'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'purchased  '}</Text>
      <Text color="green">{'██'}</Text>
      <Text dimColor>{'            120'}</Text>
    </Text>
  </VisualBox>
);

export const EventCaptureSlide: AreaSlide = {
  area: 'Event Capture',
  intro: [
    'Everything you do in PostHog starts with event captures. Every dashboard, insight, funnel, cohort, and replay is built on top of events.',
    "We're checking that your project's event capture calls cover key user actions and use sensible event names, so you can build high-quality insights and reports.",
    "We're also checking that you use a reverse proxy so your events are not blocked by ad blockers or tracking blockers.",
  ],
  visual: <CaptureVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/capture-events',
};
