import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const OptimizeVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">old-flag</Text>
      <Text dimColor>{'  100% for months, still gated in code'}</Text>
    </Text>
    <Text>
      <Text color="cyan">ghost-exp</Text>
      <Text dimColor>{' active, zero code references'}</Text>
    </Text>
    <Text dimColor>{'  └─ both still evaluated (and billed)'}</Text>
    <Text dimColor>{'     on every /flags request'}</Text>
  </VisualBox>
);

export const FlagOptimizeSlide: AreaSlide = {
  area: 'Feature Flags — Optimize',
  intro: [
    'Flags are billed by /flags requests, and active flags keep evaluating even when your code stopped referencing them — removing a flag from code does not stop the charges. Only archiving or disabling it in PostHog does.',
    "We're looking for flag debt in both directions: flags fully rolled out but still gated in code, and active flags nothing references anymore — plus local-evaluation polling costs and test runs silently burning requests.",
  ],
  visual: <OptimizeVisual />,
  docsUrl: 'https://posthog.com/docs/feature-flags/cutting-costs',
};
