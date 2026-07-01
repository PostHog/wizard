/**
 * Shared USD-per-token pricing for the agent's default model, and the cost
 * formula applied to a token usage delta.
 *
 * Single source of truth for both the benchmark's `CostTrackerPlugin`
 * (`@lib/middleware/benchmarks/cost-tracker`) and the live token/cost HUD
 * (`agent-interface.ts`'s per-turn usage accumulation), so the two estimates
 * never drift apart. Both reconcile against the SDK's own authoritative
 * `total_cost_usd` once the run finishes — this table only prices the
 * *live-updating* estimate shown while the agent is still running.
 */

/** Claude Sonnet 4.6 pricing (USD per 1M tokens) */
export const PRICE_PER_MTOK = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheCreation5m: 3.75,
  cacheCreation1h: 6,
} as const;

/**
 * Cost in USD for one usage delta. `cacheCreation5m`/`cacheCreation1h` come
 * from the SDK's `usage.cache_creation` breakdown, which is only reported on
 * some turns — when both are 0, `cacheCreationFallback` (the plain
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
): number {
  const hasBreakdown = cacheCreation5m > 0 || cacheCreation1h > 0;
  return (
    inputTokens * (PRICE_PER_MTOK.input / 1e6) +
    outputTokens * (PRICE_PER_MTOK.output / 1e6) +
    cacheReadTokens * (PRICE_PER_MTOK.cacheRead / 1e6) +
    (hasBreakdown
      ? cacheCreation5m * (PRICE_PER_MTOK.cacheCreation5m / 1e6) +
        cacheCreation1h * (PRICE_PER_MTOK.cacheCreation1h / 1e6)
      : cacheCreationFallback * (PRICE_PER_MTOK.cacheCreation5m / 1e6))
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
