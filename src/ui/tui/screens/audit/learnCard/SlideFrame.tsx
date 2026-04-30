import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { Colors } from '../../../styles.js';

interface SlideFrameProps {
  visual: ReactNode;
  children: ReactNode;
}

export const SlideFrame = ({ visual, children }: SlideFrameProps) => (
  <Box flexDirection="column">
    <VisualBox>{visual}</VisualBox>
    <Text>{children}</Text>
  </Box>
);

export const VisualBox = ({ children }: { children: ReactNode }) => (
  <Box
    borderStyle="single"
    borderColor={Colors.muted}
    paddingX={1}
    marginBottom={1}
    flexDirection="column"
  >
    {children}
  </Box>
);
