/**
 * Shared scaffolding for the phase visuals — Matrix-green color, common
 * VisualProps shape, and the rounded `Panel` shell every visual sits in.
 *
 * Visuals each render their own grid then wrap it in `<Panel>` so phase
 * transitions stay visually continuous.
 */

import { Box } from 'ink';
import type { ReactNode } from 'react';
import { VISUALIZER_PALETTE } from './palette';

// The deep, dimmed end of the Matrix code-rain palette. Used as the framing
// color for every visual (panel border, axis lines, scaffolding glyphs).
export const MATRIX_FADE = VISUALIZER_PALETTE.fade;

export interface VisualProps {
  width: number;
  height: number;
}

export const Panel = ({ children }: { children: ReactNode }) => (
  <Box flexDirection="column" borderStyle="round" borderColor={MATRIX_FADE}>
    {children}
  </Box>
);
