import { tokenCostHudRowCount } from '@ui/tui/components/TokenCostHud';
import type { TokenUsageSnapshot } from '@ui/tui/store';

const ZERO_USAGE: TokenUsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  costIsFinal: false,
};

describe('tokenCostHudRowCount', () => {
  it('fits the hint on one row when the terminal is wide enough', () => {
    expect(tokenCostHudRowCount(ZERO_USAGE, 200)).toBe(1);
  });

  it('needs two rows when the terminal is too narrow for the hint', () => {
    expect(tokenCostHudRowCount(ZERO_USAGE, 10)).toBe(2);
  });

  it('is exactly 1 at the boundary width and 2 one column narrower', () => {
    // Walk down from a width that's definitely wide enough until the row
    // count flips, then confirm the flip is a hard boundary (no gap, no
    // off-by-one) rather than hardcoding a magic width number.
    let width = 200;
    while (tokenCostHudRowCount(ZERO_USAGE, width - 1) === 1) width -= 1;
    expect(tokenCostHudRowCount(ZERO_USAGE, width)).toBe(1);
    expect(tokenCostHudRowCount(ZERO_USAGE, width - 1)).toBe(2);
  });
});
