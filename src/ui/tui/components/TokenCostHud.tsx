/**
 * TokenCostHud — Ctrl+T panel showing the running (then final) LLM
 * token/cost estimate for this wizard run. Toggled from `ScreenContainer`;
 * deliberately not registered via `useKeyBindings`, so the shortcut never
 * shows in the `KeyboardHintsBar` in production. Defaults visible for
 * local/dev/test runs (`WizardStore`'s `$tokenHudVisible` initial value),
 * so contributors see it without needing to know the shortcut; defaults
 * hidden in the published build. Once shown, the panel itself names the
 * shortcut, so it's self-documenting either way.
 *
 * One row when "Ctrl+T to hide" fits on the same row as the cost line
 * (right-aligned, with a minimum gap), two when the terminal is too narrow
 * for both — see `tokenCostHudRowCount`, which `ScreenContainer` calls with
 * the same inputs so its height budget always matches what actually renders
 * (plus the blank spacer `ScreenContainer` renders below either way).
 */
import { Box, Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { TokenUsageSnapshot } from '@ui/tui/store';
import { formatTokenCount, formatCostUsd } from '@lib/agent/token-pricing';

/** Self-documents the hidden shortcut once the panel is showing. */
const HINT_TEXT = 'Ctrl+T to hide';
/** Minimum blank columns between the cost line and the hint when they
 *  share a row, so they never visually run together. */
const MIN_GAP = 2;

interface TokenCostLineParts {
  /** e.g. "Cost (running): $1.23" — rendered in the accent color. */
  costPart: string;
  /** e.g. " · in 12.3K · out 4.5K · cache read 1.0K · cache write 500", or
   *  " · no agent turns yet" — rendered dim. */
  breakdownPart: string;
}

function tokenCostLineParts(usage: TokenUsageSnapshot): TokenCostLineParts {
  const totalTokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens;
  const label = usage.costIsFinal ? 'Final cost' : 'Cost (running)';
  const costPart = `${label}: ${formatCostUsd(usage.costUsd)}`;

  if (totalTokens === 0) {
    return { costPart, breakdownPart: ' · no agent turns yet' };
  }
  return {
    costPart,
    breakdownPart:
      ` · in ${formatTokenCount(usage.inputTokens)}` +
      ` · out ${formatTokenCount(usage.outputTokens)}` +
      ` · cache read ${formatTokenCount(usage.cacheReadTokens)}` +
      ` · cache write ${formatTokenCount(usage.cacheCreationTokens)}`,
  };
}

/**
 * How many rows `TokenCostHud` renders for `usage` at `width` columns of
 * available text space — 1 when the hint fits on the cost line's row (with
 * `MIN_GAP` to spare), 2 when it needs its own row below. `ScreenContainer`
 * calls this with the exact same `usage`/`width` it passes to the
 * component, so its height budget can never disagree with what renders.
 */
export function tokenCostHudRowCount(
  usage: TokenUsageSnapshot,
  width: number,
): 1 | 2 {
  const { costPart, breakdownPart } = tokenCostLineParts(usage);
  const lineLength = costPart.length + breakdownPart.length;
  return lineLength + MIN_GAP + HINT_TEXT.length <= width ? 1 : 2;
}

interface TokenCostHudProps {
  usage: TokenUsageSnapshot;
  /** Available text width (columns) — decides whether the hint fits on the
   *  cost line's row. Pass the content width, not the outer box width (the
   *  panel's own `paddingX={1}` is accounted for by the caller). */
  width: number;
}

export const TokenCostHud = ({ usage, width }: TokenCostHudProps) => {
  const { costPart, breakdownPart } = tokenCostLineParts(usage);
  const inline = tokenCostHudRowCount(usage, width) === 1;
  const lineLength = costPart.length + breakdownPart.length;
  const gap = Math.max(MIN_GAP, width - lineLength - HINT_TEXT.length);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate">
        <Text color={Colors.accent}>{costPart}</Text>
        <Text dimColor>{breakdownPart}</Text>
        {inline && <Text>{' '.repeat(gap)}</Text>}
        {inline && <Text dimColor>{HINT_TEXT}</Text>}
      </Text>
      {!inline && (
        <Text dimColor wrap="truncate">
          {HINT_TEXT}
        </Text>
      )}
    </Box>
  );
};
