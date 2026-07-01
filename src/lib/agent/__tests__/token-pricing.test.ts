import {
  computeTokenCostUsd,
  pricePerMtokForModel,
  formatTokenCount,
  formatCostUsd,
} from '@lib/agent/token-pricing';

describe('pricePerMtokForModel', () => {
  it('defaults to Sonnet pricing (DEFAULT_AGENT_MODEL) when no model is given', () => {
    expect(pricePerMtokForModel(undefined)).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheCreation5m: 3.75,
      cacheCreation1h: 6,
    });
  });

  it('strips a dated release suffix to match the undated table entry', () => {
    // HAIKU_MODEL is exactly this string.
    expect(pricePerMtokForModel('claude-haiku-4-5-20251001')?.input).toBe(1);
  });

  it('does not conflate different versions of the same family', () => {
    // Regression test: an earlier version of this table matched by family
    // name ("opus", "sonnet") and priced every sibling the same, which
    // silently mis-priced e.g. Opus 4.5 at Opus 4.1's rate (3x too high).
    // Sonnet 5 must NOT resolve to Sonnet 4.6's price just because both
    // are "sonnet".
    const sonnet46 = pricePerMtokForModel('claude-sonnet-4-6');
    const sonnet5 = pricePerMtokForModel('claude-sonnet-5');
    expect(sonnet46?.input).toBe(3);
    expect(sonnet5?.input).toBe(2);
    expect(sonnet5).not.toEqual(sonnet46);
  });

  it('returns undefined for an unrecognized model, rather than guessing', () => {
    expect(pricePerMtokForModel('claude-mystery-9000')).toBeUndefined();
  });
});

describe('computeTokenCostUsd', () => {
  it('prices input, output, and cache-read tokens at their per-Mtok rates', () => {
    // 1M input ($3) + 1M output ($15) + 1M cache-read ($0.30), no cache creation.
    const cost = computeTokenCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreation5m: 0,
      cacheCreation1h: 0,
      cacheCreationTokens: 0,
    });
    expect(cost).toBeCloseTo(3 + 15 + 0.3, 5);
  });

  it('prices cache creation at the 5m/1h breakdown rates when present', () => {
    // 1M ephemeral-5m ($3.75) + 1M ephemeral-1h ($6), fallback total ignored.
    const cost = computeTokenCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5m: 1_000_000,
      cacheCreation1h: 1_000_000,
      cacheCreationTokens: 2_000_000,
    });
    expect(cost).toBeCloseTo(3.75 + 6, 5);
  });

  it('falls back to the 5m rate for the plain total when no breakdown is reported', () => {
    // Some SDK turns report cache_creation_input_tokens without the
    // ephemeral_5m/1h breakdown -- price the whole total at the 5m rate
    // rather than treating it as free.
    const cost = computeTokenCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5m: 0,
      cacheCreation1h: 0,
      cacheCreationTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3.75, 5);
  });

  it('prices a Haiku turn at Haiku rates, not Sonnet', () => {
    const cost = computeTokenCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreation5m: 0,
      cacheCreation1h: 0,
      cacheCreationTokens: 0,
      model: 'claude-haiku-4-5-20251001',
    });
    // $1/Mtok input + $5/Mtok output -- 1/3 and 1/3 of the Sonnet cost this
    // same delta would get without a model, so a Haiku-overridden run (e.g.
    // source-map detection) doesn't get billed at Sonnet's rate.
    expect(cost).toBeCloseTo(1 + 5, 5);
  });

  it('prices an Opus 4.5 turn at Opus 4.5 rates, not Opus 4.1', () => {
    const cost = computeTokenCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5m: 0,
      cacheCreation1h: 0,
      cacheCreationTokens: 0,
      model: 'claude-opus-4-5-20251101',
    });
    // $5/Mtok input -- Opus 4.5 is half of Opus 4.1's $15/Mtok published rate.
    expect(cost).toBeCloseTo(5, 5);
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
