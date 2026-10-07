import { Text } from 'ink';
import { VisualBox, type AreaSlide } from './shared.js';

const LiveDataVisual = () => (
  <VisualBox>
    <Text dimColor>your PostHog project</Text>
    <Text dimColor>{'  │'}</Text>
    <Text>
      <Text dimColor>{'  ├ '}</Text>
      <Text color="yellow">⚠</Text>
      <Text dimColor> source maps not uploaded</Text>
    </Text>
    <Text>
      <Text dimColor>{'  └ '}</Text>
      <Text color="cyan">•</Text>
      <Text dimColor> error alerts not wired</Text>
    </Text>
  </VisualBox>
);

export const LiveDataSlide: AreaSlide = {
  area: 'Live Data',
  intro: [
    'Everything so far came from reading your code. This part comes from your data.',
    'PostHog runs its own checks on what your project actually sends — whether stack traces resolve to your original source, whether a warehouse sync keeps failing, whether anyone is alerted when a new error appears. None of that is visible in a file.',
    'We pull the open ones in so this report covers both halves.',
  ],
  visual: <LiveDataVisual />,
  docsUrl: 'https://posthog.com/docs/error-tracking/upload-source-maps',
};
