import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../shared.js';

const QueryVisual = () => (
  <VisualBox>
    <Text dimColor>{'SELECT event, count() AS volume_30d'}</Text>
    <Text dimColor>
      {'FROM events WHERE timestamp > now() - INTERVAL 30 DAY'}
    </Text>
    <Text dimColor>{'GROUP BY event ORDER BY volume_30d DESC'}</Text>
    <Text> </Text>
    <Text>
      <Text color="cyan">{'pageview          '}</Text>
      <Text color="green">{'12,430'}</Text>
    </Text>
    <Text>
      <Text color="cyan">{'signup_completed  '}</Text>
      <Text color="green">{'   840'}</Text>
    </Text>
  </VisualBox>
);

export const QueryVolumeSlide: AreaSlide = {
  area: 'Query PostHog',
  intro: [
    'We ask PostHog how often each event in the inventory has fired in the last 30 days.',
    "Events your code captures but PostHog has never seen are flagged as phantoms. Phantoms usually mean a typo, a dead code path, or instrumentation that hasn't shipped yet. Worth cleaning up.",
    "If PostHog isn't reachable the audit still finishes. The report just notes where volume numbers would have gone.",
  ],
  visual: <QueryVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/sql',
};
