/**
 * SplitView — Two-pane horizontal layout: 2/3 left, 1/3 right.
 */

import { Box } from 'ink';
import type { ReactNode } from 'react';

interface SplitViewProps {
  left: ReactNode;
  right: ReactNode;
  gap?: number;
}

export const SplitView = ({ left, right, gap = 2 }: SplitViewProps) => {
  return (
    <Box flexDirection="row" flexGrow={1} gap={gap}>
      <Box width="66%" flexDirection="column">
        {left}
      </Box>
      <Box width="34%" flexDirection="column">
        {right}
      </Box>
    </Box>
  );
};
