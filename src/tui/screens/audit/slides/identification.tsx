import { Text } from 'ink';
import { VisualBox, type AreaSlide } from './shared.js';

const IdentificationVisual = () => (
  <VisualBox>
    <Text>
      <Text bold>{'browser '}</Text>
      <Text dimColor>capture</Text>
      <Text>{' ('}</Text>
      <Text color="cyan">u_42</Text>
      <Text>{', "click")'}</Text>
    </Text>
    <Text dimColor>{'           │'}</Text>
    <Text>
      <Text dimColor>{'           ▼ '}</Text>
      <Text color="green">same distinct_id</Text>
    </Text>
    <Text dimColor>{'           │'}</Text>
    <Text>
      <Text bold>{'server  '}</Text>
      <Text dimColor>capture</Text>
      <Text>{' ('}</Text>
      <Text color="cyan">u_42</Text>
      <Text>{', "charged")'}</Text>
    </Text>
  </VisualBox>
);

export const IdentificationSlide: AreaSlide = {
  area: 'Identification',
  intro: [
    'For events to be useful, they need to be reliably attributed to a user.',
    "We're checking your project's `identify()` calls to make sure they're correctly and consistently implemented.",
    "We're also checking that your `distinct_id`s are correctly passed between your client and server runtimes if applicable.",
  ],
  visual: <IdentificationVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/identify',
};
