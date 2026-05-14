import { Text } from 'ink';
import { VisualBox, type AreaSlide } from '../../audit/slides/shared.js';

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
    'LEVEL 5: EVENT QUALITY. The capture call-sites are clean. The events themselves are the real boss fight.',
    'Scanning for: naming inconsistencies, semantic duplicates, kitchen-sink event payloads, and (if your PostHog project is linked) which captured events actually drive insights and dashboards.',
    '4 subagents fan out in parallel. The ticker shows them clearing checks live.',
  ],
  visual: <EventQualityVisual />,
  docsUrl: 'https://posthog.com/docs/product-analytics/best-practices',
};
