/**
 * Shared USD-per-token pricing by model family, and the cost formula applied
 * to a token usage delta.
 *
 * Single source of truth for both the benchmark's `CostTrackerPlugin`
 * (`@lib/middleware/benchmarks/cost-tracker`) and the live token/cost HUD
 * (`agent-interface.ts`'s per-turn usage accumulation), so the two estimates
 * never drift apart. Both reconcile against the SDK's own authoritative
 * `total_cost_usd` once the run finishes — this table only prices the
 * *live-updating* estimate shown while the agent is still running.
 *
 * Model-aware because a run's model isn't fixed: `AgentConfig.modelOverride`
 * switches specific programs to Haiku (e.g. source-map detection), and the
 * SDK reports a `model` string on every individual assistant turn (subagents
 * dispatched via the Agent tool can run on a different model than the main
 * session) — pricing everything at one flat rate would badly misprice a
 * Haiku-priced turn as if it were Sonnet. Callers that know the turn's model
 * should pass it; callers that don't (e.g. a caller with no model context)
 * fall back to Sonnet, the default model for interactive runs.
 */

export interface PricePerMtok {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

/**
 * Cache pricing follows Anthropic's standard ratios relative to input —
 * cacheRead = input × 0.1, cacheCreation5m = input × 1.25, cacheCreation1h =
 * input × 2 — consistent across the model families below. Verify against
 * https://www.anthropic.com/pricing if a rate ever looks stale.
 */
const HAIKU_PRICE_PER_MTOK: PricePerMtok = {
  input: 1,
  output: 5,
  cacheRead: 0.1,
  cacheCreation5m: 1.25,
  cacheCreation1h: 2,
};

/** Claude Sonnet 4.6 pricing (USD per 1M tokens) — the default model. */
const SONNET_PRICE_PER_MTOK: PricePerMtok = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheCreation5m: 3.75,
  cacheCreation1h: 6,
};

const OPUS_PRICE_PER_MTOK: PricePerMtok = {
  input: 15,
  output: 75,
  cacheRead: 1.5,
  cacheCreation5m: 18.75,
  cacheCreation1h: 30,
};

/**
 * The default model's price table, for callers with no model context.
 * @deprecated Prefer `pricePerMtokForModel(model)` — kept for the (rare)
 * caller that genuinely doesn't have a model string available.
 */
export const PRICE_PER_MTOK = SONNET_PRICE_PER_MTOK;

/**
 * Resolve the right price table for a model id, matched on a substring
 * (e.g. `claude-haiku-4-5-20251001` matches `'haiku'`) so a dated version
 * suffix never breaks the match. Missing/unrecognized model falls back to
 * Sonnet, the default model for interactive runs.
 */
export function pricePerMtokForModel(model?: string): PricePerMtok {
  if (!model) return SONNET_PRICE_PER_MTOK;
  if (model.includes('haiku')) return HAIKU_PRICE_PER_MTOK;
  if (model.includes('opus')) return OPUS_PRICE_PER_MTOK;
  return SONNET_PRICE_PER_MTOK;
}

/**
 * Cost in USD for one usage delta, priced at `model`'s rates (see
 * `pricePerMtokForModel`). `cacheCreation5m`/`cacheCreation1h` come from the
 * SDK's `usage.cache_creation` breakdown, which is only reported on some
 * turns — when both are 0, `cacheCreationFallback` (the plain
 * `cache_creation_input_tokens` total) is priced at the 5m rate instead, so a
 * turn without the breakdown still gets a reasonable estimate rather than
 * being priced at $0.
 */
export function computeTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreation5m: number,
  cacheCreation1h: number,
  cacheCreationFallback: number,
  model?: string,
): number {
  const price = pricePerMtokForModel(model);
  const hasBreakdown = cacheCreation5m > 0 || cacheCreation1h > 0;
  return (
    inputTokens * (price.input / 1e6) +
    outputTokens * (price.output / 1e6) +
    cacheReadTokens * (price.cacheRead / 1e6) +
    (hasBreakdown
      ? cacheCreation5m * (price.cacheCreation5m / 1e6) +
        cacheCreation1h * (price.cacheCreation1h / 1e6)
      : cacheCreationFallback * (price.cacheCreation5m / 1e6))
  );
}

/**
 * Shared display formatters for the hidden Ctrl+T HUD (`TokenCostHud`) and
 * the post-exit scrollback line (`exit-line.ts`) — kept here, not in either
 * of those files, since `exit-line.ts` is deliberately free of `ink`/React
 * imports (it must stay a pure, unit-testable function), and importing a
 * named export from a `.tsx` file would pull `ink` into its module graph
 * anyway. This module has no such dependency.
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatCostUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
