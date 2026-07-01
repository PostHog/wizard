import {
  computeTokenCostUsd,
  formatTokenCount,
  formatCostUsd,
} from '@lib/agent/token-pricing';

describe('computeTokenCostUsd', () => {
  it('prices input, output, and cache-read tokens at their per-Mtok rates', () => {
    // 1M input ($3) + 1M output ($15) + 1M cache-read ($0.30), no cache creation.
    const cost = computeTokenCostUsd(1_000_000, 1_000_000, 1_000_000, 0, 0, 0);
    expect(cost).toBeCloseTo(3 + 15 + 0.3, 5);
  });

  it('prices cache creation at the 5m/1h breakdown rates when present', () => {
    // 1M ephemeral-5m ($3.75) + 1M ephemeral-1h ($6), fallback total ignored.
    const cost = computeTokenCostUsd(0, 0, 0, 1_000_000, 1_000_000, 2_000_000);
    expect(cost).toBeCloseTo(3.75 + 6, 5);
  });

  it('falls back to the 5m rate for the plain total when no breakdown is reported', () => {
    // Some SDK turns report cache_creation_input_tokens without the
    // ephemeral_5m/1h breakdown -- price the whole total at the 5m rate
    // rather than treating it as free.
    const cost = computeTokenCostUsd(0, 0, 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(3.75, 5);
  });

  it('returns 0 for an all-zero usage delta', () => {
    expect(computeTokenCostUsd(0, 0, 0, 0, 0, 0)).toBe(0);
  });
});

describe('formatTokenCount', () => {
  it('formats sub-thousand counts verbatim', () => {
    expect(formatTokenCount(42)).toBe('42');
  });

  it('formats thousands with a K suffix', () => {
    expect(formatTokenCount(12_345)).toBe('12.3K');
  });

  it('formats millions with an M suffix', () => {
    expect(formatTokenCount(2_500_000)).toBe('2.50M');
  });
});

describe('formatCostUsd', () => {
  it('formats ordinary costs to 2 decimal places', () => {
    expect(formatCostUsd(1.2345)).toBe('$1.23');
  });

  it('shows 4 decimal places for sub-cent costs, so they do not round to $0.00', () => {
    expect(formatCostUsd(0.0042)).toBe('$0.0042');
  });

  it('formats zero as $0.00, not the sub-cent form', () => {
    expect(formatCostUsd(0)).toBe('$0.00');
  });
});
