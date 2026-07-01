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

const BUSY_USAGE: TokenUsageSnapshot = {
  inputTokens: 1_234_567,
  outputTokens: 234_567,
  cacheReadTokens: 45_678,
  cacheCreationTokens: 5_678,
  costUsd: 12.3456,
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

  it('needs more width for a busy run than an empty one, since the token breakdown lengthens the line', () => {
    let zeroWidth = 200;
    while (tokenCostHudRowCount(ZERO_USAGE, zeroWidth - 1) === 1) {
      zeroWidth -= 1;
    }
    let busyWidth = 200;
    while (tokenCostHudRowCount(BUSY_USAGE, busyWidth - 1) === 1) {
      busyWidth -= 1;
    }
    expect(busyWidth).toBeGreaterThan(zeroWidth);
  });

  it('labels the line "Final cost" once reconciled, same length rules apply', () => {
    const finalUsage: TokenUsageSnapshot = { ...BUSY_USAGE, costIsFinal: true };
    // Same-shaped cost line either way -- just confirms the final-cost path
    // doesn't crash or behave differently from the running-cost path here.
    expect(tokenCostHudRowCount(finalUsage, 200)).toBe(1);
    expect(tokenCostHudRowCount(finalUsage, 10)).toBe(2);
  });
});
