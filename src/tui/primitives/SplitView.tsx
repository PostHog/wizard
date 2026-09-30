/**
 * SplitView — Two-pane horizontal layout: 50/50.
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
    <Box flexDirection="row" flexGrow={1} flexShrink={1} gap={gap}>
      <Box width="50%" flexDirection="column" overflow="hidden">
        {left}
      </Box>
      <Box width="50%" flexDirection="column" overflow="hidden">
        {right}
      </Box>
    </Box>
  );
};
