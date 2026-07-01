/**
 * Shared exact-match USD-per-token pricing by model id, and the cost formula
 * applied to a token usage delta.
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
 * session).
 *
 * Deliberately matched by *exact* model id, not family name (no
 * `model.includes('opus')`-style fallback): different versions of the same
 * family are priced differently — e.g. Claude Opus 4.5 ($5/$25 per Mtok) is
 * half of Opus 4.1's rate ($15/$75) — so matching on "opus" or "sonnet"
 * alone silently mis-prices a newer/older sibling at the wrong rate. The
 * only normalization applied is stripping a trailing release-date suffix
 * (`stripDateSuffix`), since Anthropic's dated and undated ids for the
 * *same* version always carry the same price (verified for every entry
 * below). Claude Sonnet 5 is the one exception with a *time-dependent*
 * price — see `sonnet5Price` — rather than a fixed table entry.
 *
 * Prices verified against https://models.dev/api.json (Anthropic section)
 * on 2026-07-01 — re-verify there when adding an entry or bumping
 * DEFAULT_AGENT_MODEL/HAIKU_MODEL, since this table isn't fetched live.
 */

import { DEFAULT_AGENT_MODEL } from '@lib/constants';

export interface PricePerMtok {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

/**
 * `cacheCreation1h` isn't published by models.dev (it only has one
 * cache-write rate); extrapolated at `input × 2`, the ratio that holds for
 * every model below (mirrors `cacheCreation5m` = `input × 1.25`, `cacheRead`
 * = `input × 0.1` — Anthropic's standard prompt-caching multipliers).
 * Rounded to 6 decimal places to clean up binary float noise from the
 * multiplication (e.g. `3 * 0.1` is `0.30000000000000004`, not `0.3`) — well
 * past cent-level precision at the 1M-token scale these prices are quoted at.
 */
function pricingFromInput(input: number, output: number): PricePerMtok {
  const round = (n: number): number => Math.round(n * 1e6) / 1e6;
  return {
    input,
    output,
    cacheRead: round(input * 0.1),
    cacheCreation5m: round(input * 1.25),
    cacheCreation1h: round(input * 2),
  };
}

/**
 * Exact-match price table, keyed by the *undated* model id prefix —
 * `pricePerMtokForModel` strips a dated suffix before falling back to this
 * table, so e.g. `HAIKU_MODEL` (`claude-haiku-4-5-20251001`) resolves via
 * the `'claude-haiku-4-5'` entry without needing its own duplicate key.
 * `DEFAULT_AGENT_MODEL` (`claude-sonnet-4-6`) has no date suffix, so it's
 * keyed directly. The rest are additional real Anthropic model ids kept
 * priced correctly in case a subagent or a future default ever reports one
 * (a turn on an id NOT in this table contributes $0 to the live estimate
 * rather than guessing — see `pricePerMtokForModel`).
 *
 * `'claude-sonnet-5'` is intentionally absent — its price is time-dependent
 * (promotional launch discount), so it's resolved separately by
 * `pricePerMtokForModel` via `SONNET_5_PRICE`.
 */
const PRICE_TABLE: Record<string, PricePerMtok> = {
  [DEFAULT_AGENT_MODEL]: pricingFromInput(3, 15),
  'claude-haiku-4-5': pricingFromInput(1, 5), // HAIKU_MODEL + a date suffix
  'claude-opus-4-5': pricingFromInput(5, 25),
};

/**
 * Claude Sonnet 5 launched at a promotional discount through 2026-08-31
 * UTC; from 2026-09-01 it reverts to the same rate as Sonnet 4.6 ($3/$15)
 * — not a coincidence, Anthropic prices it identically to 4.6 once the
 * promo ends. Re-verify against https://models.dev/api.json if this ever
 * looks off, and delete this special case once the promo window has
 * passed (its `PRICE_TABLE[DEFAULT_AGENT_MODEL]` price is the same anyway).
 */
const SONNET_5_PROMO_ENDS_UTC = new Date('2026-09-01T00:00:00Z');

function sonnet5Price(now: Date): PricePerMtok {
  return now < SONNET_5_PROMO_ENDS_UTC
    ? pricingFromInput(2, 10)
    : pricingFromInput(3, 15);
}

/** Strips a trailing 8-digit release-date suffix (e.g. `-20251001`) — never
 *  the version segment, so differently-versioned models are never conflated.
 *  `claude-haiku-4-5-20251001` → `claude-haiku-4-5`; `claude-sonnet-4-6` (no
 *  date suffix) is returned unchanged. */
function stripDateSuffix(model: string): string {
  return model.replace(/-\d{8}$/, '');
}

/**
 * Exact-match pricing lookup. `undefined` model (a caller with no model
 * context, e.g. the benchmark's `CostTrackerPlugin`) falls back to
 * `DEFAULT_AGENT_MODEL`'s price, the default for interactive runs. A
 * *given* but unrecognized model id returns `undefined` rather than
 * guessing from its family name — seeing `undefined` and skipping that
 * delta is strictly more accurate than the family-fallback this replaced,
 * which silently priced e.g. every Opus turn at Opus 4.1's rate.
 *
 * `now` is injectable (defaults to the real clock) only so
 * `sonnet5Price`'s promo-window check is deterministic in tests — no
 * other entry in this table is time-dependent.
 */
export function pricePerMtokForModel(
  model?: string,
  now: Date = new Date(),
): PricePerMtok | undefined {
  if (!model) return PRICE_TABLE[DEFAULT_AGENT_MODEL];
  const undated = stripDateSuffix(model);
  if (undated === 'claude-sonnet-5') return sonnet5Price(now);
  return PRICE_TABLE[model] ?? PRICE_TABLE[undated];
}

/**
 * Cost in USD for one usage delta, priced at `usage.model`'s exact rates
 * (see `pricePerMtokForModel`) — 0 when `model` is given but not in the
 * table, rather than guessing. `cacheCreation5m`/`cacheCreation1h` come from
 * the SDK's `usage.cache_creation` breakdown, which is only reported on
 * some turns — when both are 0, `cacheCreationTokens` (the plain
 * `cache_creation_input_tokens` total) is priced at the 5m rate instead, so
 * a turn without the breakdown still gets a reasonable estimate rather than
 * being priced at $0.
 *
 * Takes the same shape as `TokenUsageDelta` (`@ui/wizard-ui`) so a caller
 * that already has one — `WizardStore.addTokenUsage` — can pass it straight
 * through instead of re-listing its fields in a fixed positional order.
 */
export function computeTokenCostUsd(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  cacheCreationTokens: number;
  model?: string;
}): number {
  const price = pricePerMtokForModel(usage.model);
  if (!price) return 0;
  const hasBreakdown = usage.cacheCreation5m > 0 || usage.cacheCreation1h > 0;
  return (
    usage.inputTokens * (price.input / 1e6) +
    usage.outputTokens * (price.output / 1e6) +
    usage.cacheReadTokens * (price.cacheRead / 1e6) +
    (hasBreakdown
      ? usage.cacheCreation5m * (price.cacheCreation5m / 1e6) +
        usage.cacheCreation1h * (price.cacheCreation1h / 1e6)
      : usage.cacheCreationTokens * (price.cacheCreation5m / 1e6))
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
