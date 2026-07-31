import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const ReportVisual = () => (
  <VisualBox>
    <Text>Events audit report</Text>
    <Text>
      <Text dimColor>{'  # '}</Text>
      <Text>Identity &amp; segmentation</Text>
    </Text>
    <Text>
      <Text dimColor>{'  # '}</Text>
      <Text>Coverage map</Text>
    </Text>
    <Text>
      <Text dimColor>{'  # '}</Text>
      <Text>Data quality</Text>
    </Text>
    <Text>
      <Text dimColor>{'  # '}</Text>
      <Text>Events by file &amp; area</Text>
    </Text>
  </VisualBox>
);

export const WriteReportSlide: AreaSlide = {
  area: 'Write report',
  intro: [
    'We package everything we found into one report. This is what you hand to the team.',
    'The report covers how users get identified, which parts of your codebase capture which events, data quality issues like duplicates and phantoms, and a volume map of every event your code captures.',
    'Nothing in your project is modified — the report goes into a PostHog notebook in the next step, not into your repo.',
  ],
  visual: <ReportVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
};
