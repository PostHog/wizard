import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '@ui/tui/screens/audit/slides/shared';

const EventQualityVisual = () => (
  <VisualBox>
    <Text>
      <Text color="green">{'event_clicked    '}</Text>
      <Text color="green">{'\u2713'}</Text>
    </Text>
    <Text>
      <Text color="yellow">{'eventClicked     '}</Text>
      <Text color="yellow">{'~  duplicate?'}</Text>
    </Text>
    <Text>
      <Text color="yellow">{'click_event      '}</Text>
      <Text color="yellow">{'~  duplicate?'}</Text>
    </Text>
    <Text>
      <Text color="red">{'big_kitchen_sink '}</Text>
      <Text color="red">{'\u2717  22 props'}</Text>
    </Text>
  </VisualBox>
);

export const EventQualitySlide: AreaSlide = {
  area: 'Event Quality',
  intro: [
    'Even when the capture call-sites are clean, the events themselves can drift — inconsistent names, accidental duplicates, properties stuffed onto a single event — which quietly distorts every downstream funnel, retention, and dashboard.',
    "We're checking naming consistency, looking for semantic duplicates (the same user action captured under two names), spotting kitchen-sink payloads, and — if your PostHog project is reachable — whether the events being captured actually drive any insight or dashboard.",
    '4 subagents fan out in parallel; the score ticker on the right shows them clearing checks live.',
  ],
  visual: <EventQualityVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
};
