import { Box, Text } from 'ink';

interface AreaHeaderRowProps {
  area: string;
  resolved: number;
  total: number;
}

/** Sub-header row inside the scrollable body — one per area group. */
export const AreaHeaderRow = ({
  area,
  resolved,
  total,
}: AreaHeaderRowProps) => (
  <Box flexShrink={0} marginTop={1}>
    <Text bold color="cyan">
      {area}{' '}
    </Text>
    <Text dimColor>
      ({resolved}/{total})
    </Text>
  </Box>
);
