/**
 * EventPlanViewer — Renders a table of planned analytics events.
 */

import { Box, Text } from 'ink';
import type { PlannedEvent } from '../store.js';

interface EventPlanViewerProps {
  events: PlannedEvent[];
}

export const EventPlanViewer = ({ events }: EventPlanViewerProps) => {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Event plan</Text>
      <Box height={1} />
      {events.map((event) => (
        <Box key={event.name}>
          <Text bold>{event.name}</Text>
          <Text dimColor> {event.description}</Text>
        </Box>
      ))}
    </Box>
  );
};
