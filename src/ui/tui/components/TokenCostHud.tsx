/**
 * TokenCostHud — Ctrl+T panel showing the running (then final) LLM
 * token/cost estimate for this wizard run. Toggled from `ScreenContainer`;
 * deliberately not registered via `useKeyBindings`, so the shortcut never
 * shows in the `KeyboardHintsBar` in production. Defaults visible for
 * local/dev/test runs (`WizardStore`'s `$tokenHudVisible` initial value),
 * so contributors see it without needing to know the shortcut; defaults
 * hidden in the published build. Once shown, the panel itself names the
 * shortcut (below), so it's self-documenting either way.
 *
 * Exactly two rows (this line + the blank spacer `ScreenContainer` renders
 * below it), so `ScreenContainer` can budget a fixed extra height for it
 * without risking layout overflow when the terminal is narrow.
 */
import { Box, Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { TokenUsageSnapshot } from '@ui/tui/store';
import { formatTokenCount, formatCostUsd } from '@lib/agent/token-pricing';

interface TokenCostHudProps {
  usage: TokenUsageSnapshot;
}

export const TokenCostHud = ({ usage }: TokenCostHudProps) => {
  const totalTokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens;

  const label = usage.costIsFinal ? 'Final cost' : 'Cost (running)';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={Colors.accent} wrap="truncate">
        {label}: {formatCostUsd(usage.costUsd)}
        {totalTokens > 0 && (
          <Text dimColor>
            {' · in '}
            {formatTokenCount(usage.inputTokens)}
            {' · out '}
            {formatTokenCount(usage.outputTokens)}
            {' · cache read '}
            {formatTokenCount(usage.cacheReadTokens)}
            {' · cache write '}
            {formatTokenCount(usage.cacheCreationTokens)}
          </Text>
        )}
        {totalTokens === 0 && <Text dimColor> · no agent turns yet</Text>}
      </Text>
      <Text dimColor wrap="truncate">
        Ctrl+T to hide
      </Text>
    </Box>
  );
};
