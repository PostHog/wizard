import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const EnrichVisual = () => (
  <VisualBox>
    <Text dimColor>orchestrator</Text>
    <Text dimColor>{'  │'}</Text>
    <Text>
      <Text dimColor>{'  ├─ '}</Text>
      <Text color="cyan">subagent 1</Text>
      <Text dimColor>{'  → part-1.json'}</Text>
    </Text>
    <Text>
      <Text dimColor>{'  ├─ '}</Text>
      <Text color="cyan">subagent 2</Text>
      <Text dimColor>{'  → part-2.json'}</Text>
    </Text>
    <Text>
      <Text dimColor>{'  └─ '}</Text>
      <Text color="cyan">subagent N</Text>
      <Text dimColor>{'  → part-N.json'}</Text>
    </Text>
  </VisualBox>
);

export const EnrichSitesSlide: AreaSlide = {
  area: 'Enrich',
  intro: [
    'Now we look inside each file that captures events. The goal is to know not just that an event fires, but what it is, where it lives, and what data goes with it.',
    'For every capture site we pull out the event name, the properties, the area of your codebase it sits in, and the surrounding function or component.',
    'This is the only step that opens source files. Large codebases run in parallel so it finishes in one pass.',
  ],
  visual: <EnrichVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
};
