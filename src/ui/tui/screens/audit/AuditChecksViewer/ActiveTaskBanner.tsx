import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { AuditTaskItem } from './types.js';

interface ActiveTaskBannerProps {
  task: AuditTaskItem;
}

export const ActiveTaskBanner = ({ task }: ActiveTaskBannerProps) => (
  <Box gap={1}>
    <Spinner />
    <Text>
      <Text dimColor>Working on </Text>
      <Text bold>{task.activeForm ?? task.label}</Text>
    </Text>
  </Box>
);
