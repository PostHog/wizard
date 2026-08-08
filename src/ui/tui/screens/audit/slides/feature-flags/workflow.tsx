import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const WorkflowVisual = () => (
  <VisualBox>
    <Text>
      <Text dimColor>{'[x] '}</Text>
      <Text>fix typo'd key </Text>
      <Text color="cyan">beta-serach</Text>
    </Text>
    <Text>
      <Text dimColor>{'[x] '}</Text>
      <Text>strip gate for </Text>
      <Text color="cyan">new-nav</Text>
      <Text dimColor>{'  (100%)'}</Text>
    </Text>
    <Text>
      <Text dimColor>{'[ ] '}</Text>
      <Text dimColor>archive unused flags…</Text>
    </Text>
    <Text dimColor>{'  └─ only what you pick, safe order'}</Text>
  </VisualBox>
);

export const FlagWorkflowSlide: AreaSlide = {
  area: 'Workflow',
  intro: [
    "The findings become a checklist — you pick which fixes to apply, and nothing you don't pick gets touched.",
    'Fixes follow the safe cleanup order: code gates are stripped first and flags are only disabled in PostHog after you deploy — never the other way around, so a live feature is never switched off under running code.',
  ],
  visual: <WorkflowVisual />,
  docsUrl: 'https://posthog.com/docs/feature-flags/cleaning-up-stale-flags',
};
