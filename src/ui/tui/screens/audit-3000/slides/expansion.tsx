import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '@ui/tui/screens/audit/slides/shared';

const ExpansionVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">{'product analytics  '}</Text>
      <Text color="green">{'\u25A0\u25A0\u25A0\u25A0\u25A0'}</Text>
      <Text dimColor>{'  in use'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'error tracking     '}</Text>
      <Text color="yellow">{'\u25A1\u25A1\u25A1\u25A1\u25A1'}</Text>
      <Text dimColor>{'  separate tool detected'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'session replay     '}</Text>
      <Text color="yellow">{'\u25A0\u25A0\u25A1\u25A1\u25A1'}</Text>
      <Text dimColor>{'  partial coverage'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'llm observability  '}</Text>
      <Text dimColor>
        {'\u25A1\u25A1\u25A1\u25A1\u25A1  nothing in place yet'}
      </Text>
    </Text>
  </VisualBox>
);

export const ExpansionSlide: AreaSlide = {
  area: 'Stack consolidation',
  intro: [
    'Maintaining several point tools for analytics, error tracking, replay, flags, and so on is expensive — separate contracts, mismatched user IDs, and a lot of glue code to keep the data consistent.',
    "We're scanning the codebase for which of these concerns are currently covered by PostHog, which are handled by a separate tool, and which are not addressed at all. The point is to see where consolidating onto one platform would simplify your stack — not to push every product.",
    "Each of PostHog's eight product surfaces gets one verdict: already covered by PostHog, handled by a separate tool, partial coverage, or no tool in place. The notebook lays out the findings so you can decide where consolidation actually helps.",
  ],
  visual: <ExpansionVisual />,
  docsUrl: 'https://posthog.com/docs',
};
