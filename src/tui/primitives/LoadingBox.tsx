/**
 * LoadingBox — Spinner with message.
 */

import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';

interface LoadingBoxProps {
  message: string;
}

export const LoadingBox = ({ message }: LoadingBoxProps) => {
  return (
    <Box gap={1}>
      <Spinner />
      <Text>{message}</Text>
    </Box>
  );
};
