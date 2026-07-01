import {
  computeTokenCostUsd,
  pricePerMtokForModel,
  formatTokenCount,
  formatCostUsd,
} from '@lib/agent/token-pricing';

describe('pricePerMtokForModel', () => {
  it('defaults to Sonnet pricing when no model is given', () => {
    expect(pricePerMtokForModel(undefined)).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheCreation5m: 3.75,
      cacheCreation1h: 6,
    });
  });

  it('matches Haiku by substring, ignoring the dated version suffix', () => {
    expect(pricePerMtokForModel('claude-haiku-4-5-20251001').input).toBe(1);
  });

  it('matches Opus by substring', () => {
    expect(pricePerMtokForModel('claude-opus-4-5-20251101').input).toBe(15);
  });

  it('falls back to Sonnet pricing for an unrecognized model', () => {
    expect(pricePerMtokForModel('claude-mystery-9000').input).toBe(3);
  });
});

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

  it('defaults to Sonnet pricing when no model is passed', () => {
    const cost = computeTokenCostUsd(1_000_000, 0, 0, 0, 0, 0);
    expect(cost).toBeCloseTo(3, 5);
  });

  it('prices a Haiku turn at Haiku rates, not Sonnet', () => {
    const cost = computeTokenCostUsd(
      1_000_000,
      1_000_000,
      0,
      0,
      0,
      0,
      'claude-haiku-4-5-20251001',
    );
    // $1/Mtok input + $5/Mtok output -- 1/3 and 1/3 of the Sonnet cost this
    // same delta would get without a model, so a Haiku-overridden run (e.g.
    // source-map detection) doesn't get billed at Sonnet's rate.
    expect(cost).toBeCloseTo(1 + 5, 5);
  });

  it('prices an Opus turn at Opus rates', () => {
    const cost = computeTokenCostUsd(
      1_000_000,
      0,
      0,
      0,
      0,
      0,
      'claude-opus-4-5-20251101',
    );
    expect(cost).toBeCloseTo(15, 5);
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
