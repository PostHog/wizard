import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Legend } from './Legend.js';

interface EmptyStateProps {
  cols: number;
  height: number;
}

export const EmptyState = ({ cols, height }: EmptyStateProps) => {
  const blockWidth = Math.min(64, Math.max(40, cols - 4));
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      height={height}
      justifyContent="center"
      alignItems="center"
    >
      <Box flexDirection="column" width={blockWidth}>
        <Box gap={1}>
          <Spinner />
          <Text bold>Loading audit skills</Text>
        </Box>
        <Box height={2} />
        <Text dimColor>The agent is gathering checks for this project.</Text>
        <Box height={1} />
        <Text dimColor>
          Each check appears here the moment it's queued, then resolves to:
        </Text>
        <Box height={1} />
        <Legend />
        <Box height={2} />
        <Text dimColor>Your integration will be checked in this order:</Text>
        <Box height={1} />
        <Text dimColor>Installation → Identification → Capture → Report</Text>
      </Box>
    </Box>
  );
};
