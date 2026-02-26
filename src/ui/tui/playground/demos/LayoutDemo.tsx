/**
 * LayoutDemo — Demonstrates CardLayout + SplitView.
 * Cycles alignment enums with keyboard shortcuts.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { CardLayout, SplitView } from '../../primitives/index.js';
import { HAlign, VAlign, Colors } from '../../styles.js';

const hAligns = [HAlign.Left, HAlign.Center, HAlign.Right];
const vAligns = [VAlign.Top, VAlign.Center, VAlign.Bottom];
const hLabels = ['Left', 'Center', 'Right'];
const vLabels = ['Top', 'Center', 'Bottom'];

export const LayoutDemo = () => {
  const [hIdx, setHIdx] = useState(0);
  const [vIdx, setVIdx] = useState(0);

  useInput((input) => {
    if (input === 'h') setHIdx((i) => (i + 1) % hAligns.length);
    if (input === 'v') setVIdx((i) => (i + 1) % vAligns.length);
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Layout Demo
      </Text>
      <Text dimColor>
        Press [h] to cycle hAlign ({hLabels[hIdx]}), [v] to cycle vAlign (
        {vLabels[vIdx]})
      </Text>
      <Box height={1} />
      <SplitView
        left={
          <CardLayout hAlign={hAligns[hIdx]} vAlign={vAligns[vIdx]}>
            <Box borderStyle="single" borderColor={Colors.primary} paddingX={1}>
              <Text color={Colors.primary}>Left Pane</Text>
            </Box>
          </CardLayout>
        }
        right={
          <CardLayout hAlign={HAlign.Center} vAlign={VAlign.Center}>
            <Box borderStyle="single" borderColor={Colors.accent} paddingX={1}>
              <Text color={Colors.accent}>Right Pane</Text>
            </Box>
          </CardLayout>
        }
      />
    </Box>
  );
};
