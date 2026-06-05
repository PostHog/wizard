import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const DashboardVisual = () => (
  <VisualBox>
    <Text dimColor>events audit dashboard</Text>
    <Text>
      <Text color="cyan">{'pageview    '}</Text>
      <Text color="green">{'████████████'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'signup      '}</Text>
      <Text color="green">{'████████'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'activated   '}</Text>
      <Text color="green">{'█████'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'purchased   '}</Text>
      <Text color="green">{'██'}</Text>
    </Text>
  </VisualBox>
);

export const CreateDashboardSlide: AreaSlide = {
  area: 'Create dashboard',
  intro: [
    'Finally we build a live PostHog dashboard for the events your code captures. Use it to watch volume over time, spot new phantoms, and see how traffic shifts as you ship changes.',
    'Open the dashboard from the wrap-up screen when the audit completes.',
  ],
  visual: <DashboardVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/dashboards',
};
