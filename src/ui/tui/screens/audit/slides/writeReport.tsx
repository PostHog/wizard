import { Text } from 'ink';
import { VisualBox, type AreaSlide } from './shared.js';

const ReportVisual = () => (
  <VisualBox>
    <Text dimColor>posthog-audit-report.md</Text>
    <Text>
      <Text dimColor>{'  # '}</Text>
      <Text>Summary</Text>
    </Text>
    <Text>
      <Text dimColor>{'  # '}</Text>
      <Text>Recommended actions</Text>
    </Text>
    <Text>
      <Text dimColor>{'  # '}</Text>
      <Text>Full audit</Text>
    </Text>
  </VisualBox>
);

export const WriteReportSlide: AreaSlide = {
  area: 'Write report',
  intro: [
    'Now we write an audit report at ./posthog-audit-report.md. that summarizes our findings.',
    'The report leads with a summary, then a prioritized list of fixes with file:line citations, then every check we ran grouped by area so nothing is hidden.',
    'We will upload the report into a PostHog notebook in the next step.',
  ],
  visual: <ReportVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
};
