import { Box } from 'ink';
import type { ReactNode } from 'react';
import { Colors } from '@ui/tui/styles';

/** Slide shape consumed by `AuditAreaPane`. One per `AuditCheck.area` value. */
export interface AreaSlide {
  area: string;
  /** One element per paragraph — rendered as separate `<Text>` blocks. */
  intro: string[];
  visual?: ReactNode;
  docsUrl: string;
}

/** Narrow bordered box for the small ASCII illustrations in baseline slides. */
export const VisualBox = ({ children }: { children: ReactNode }) => (
  <Box
    borderStyle="single"
    borderColor={Colors.muted}
    paddingX={1}
    flexDirection="column"
    marginBottom={1}
  >
    {children}
  </Box>
);
