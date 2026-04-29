import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';

interface ActiveTaskBannerProps {
  status: string;
}

export const ActiveTaskBanner = ({ status }: ActiveTaskBannerProps) => (
  <Box gap={1}>
    <Spinner />
    <Text>
      <Text dimColor>Working on </Text>
      <Text bold>{status}</Text>
    </Text>
  </Box>
);
