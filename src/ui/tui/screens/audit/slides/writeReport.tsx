import { Text } from 'ink';
import { VisualBox, type AreaSlide } from './shared.js';

const ReportVisual = () => (
  <VisualBox>
    <Text>Audit report</Text>
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
    'Now we write up an audit report that summarizes our findings.',
    'The report leads with a summary, then a prioritized list of fixes with file:line citations, then every check we ran grouped by area so nothing is hidden.',
    'Nothing is dropped into your repo — the report goes straight into a PostHog notebook in the next step.',
  ],
  visual: <ReportVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
};
