import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '@ui/tui/screens/audit/slides/shared';

const ExpansionVisual = () => (
  <VisualBox>
    <Text>
      <Text color="cyan">{'product analytics  '}</Text>
      <Text color="green">{'\u25A0\u25A0\u25A0\u25A0\u25A0'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'error tracking     '}</Text>
      <Text color="red">{'\u25A1\u25A1\u25A1\u25A1\u25A1'}</Text>
      <Text dimColor>{'  sentry detected'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'session replay     '}</Text>
      <Text color="yellow">{'\u25A0\u25A0\u25A1\u25A1\u25A1'}</Text>
      <Text dimColor>{'  partial'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'llm observability  '}</Text>
      <Text color="red">{'\u25A1\u25A1\u25A1\u25A1\u25A1'}</Text>
      <Text dimColor>{'  greenfield'}</Text>
    </Text>
  </VisualBox>
);

export const ExpansionSlide: AreaSlide = {
  area: 'Use Case: Expansion',
  intro: [
    'BONUS ROUND: EXPANSION. You might be paying for tools PostHog covers natively.',
    'Scanning for competitive SDKs (Sentry, LaunchDarkly, Mixpanel, Datadog, OpenTelemetry, GA4) and PostHog coverage gaps across 8 product surfaces.',
    '8 subagents in two waves of 4. Each one returns one of: cross-sell, greenfield, gap, or pass.',
  ],
  visual: <ExpansionVisual />,
  docsUrl: 'https://posthog.com/docs',
};
