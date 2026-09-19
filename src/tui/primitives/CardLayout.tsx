/**
 * CardLayout — Aligns a single child within available space.
 */

import { Box } from 'ink';
import type { ReactNode } from 'react';
import { HAlign, VAlign } from '../styles.js';

interface CardLayoutProps {
  hAlign?: HAlign;
  vAlign?: VAlign;
  children: ReactNode;
}

export const CardLayout = ({
  hAlign = HAlign.Left,
  vAlign = VAlign.Top,
  children,
}: CardLayoutProps) => {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      justifyContent={vAlign}
      alignItems={hAlign}
    >
      {children}
    </Box>
  );
};
