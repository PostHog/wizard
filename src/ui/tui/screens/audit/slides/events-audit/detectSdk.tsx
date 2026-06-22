import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const DetectVisual = () => (
  <VisualBox>
    <Text dimColor>package.json</Text>
    <Text>
      <Text dimColor>{'  └─ '}</Text>
      <Text color="green">posthog-js</Text>
      <Text dimColor>{'  ^1.200.0'}</Text>
    </Text>
    <Text dimColor>requirements.txt</Text>
    <Text>
      <Text dimColor>{'  └─ '}</Text>
      <Text color="green">posthog</Text>
      <Text dimColor>{'     ==4.0.1'}</Text>
    </Text>
  </VisualBox>
);

export const DetectSdkSlide: AreaSlide = {
  area: 'Detect SDK',
  intro: [
    'First we find which PostHog SDKs your project uses. The audit needs to know the right languages and frameworks before it looks at any code.',
    'Only dependency manifests get read here: package.json, requirements.txt, go.mod, and similar files. Source files come in a later step.',
    'If your project is a monorepo with more than one SDK, we handle each one.',
  ],
  visual: <DetectVisual />,
  docsUrl: 'https://posthog.com/docs/libraries',
};
