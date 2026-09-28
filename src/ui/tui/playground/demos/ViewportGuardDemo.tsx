/**
 * ViewportGuardDemo — Playground demo for the ViewportTooSmall primitive.
 *
 * The real thing only appears when the terminal drops below the minimum, at
 * which point the playground itself is hidden behind it — so render it here at
 * a couple of fake sizes to see the copy and the wrapping.
 */

import { Box, Text } from 'ink';
import {
  ViewportTooSmall,
  MIN_VIEWPORT_COLUMNS,
  MIN_VIEWPORT_ROWS,
} from '@ui/tui/primitives/index';

const SAMPLES: Array<[number, number]> = [
  [70, 8],
  [40, 7],
];

export const ViewportGuardDemo = () => {
  return (
    <Box flexDirection="column" gap={1} flexGrow={1}>
      <Text dimColor>
        {`Shown full-screen whenever the terminal is under ${MIN_VIEWPORT_COLUMNS}×${MIN_VIEWPORT_ROWS} — shrink this window to see it for real.`}
      </Text>
      {SAMPLES.map(([columns, rows]) => (
        <Box key={`${columns}x${rows}`} flexDirection="column">
          <Text dimColor>{`at ${columns}×${rows}:`}</Text>
          <ViewportTooSmall columns={columns} rows={rows} />
        </Box>
      ))}
    </Box>
  );
};
