import type {
  Middleware,
  MiddlewareContext,
  MiddlewareStore,
} from '@lib/middleware/types';
import { computeTokenCostUsd } from '@lib/agent/token-pricing';
import type { TokenData } from './token-tracker';
import type { CacheData } from './cache-tracker';

export interface CostData {
  totalCost: number;
  phaseCosts: Array<{ phase: string; cost: number }>;
}

// Pricing table + formula moved to `@lib/agent/token-pricing` so the live
// token/cost HUD's per-turn estimate can't drift from this benchmark's.
// No model is passed here (falls back to Sonnet pricing) -- MiddlewareContext
// has no model field to thread through, and `--benchmark` always measures
// the default flow, never a Haiku-overridden program. Still reconciles to
// the SDK's authoritative total_cost_usd in onFinalize below, same as the
// live HUD, so this only risks the unreconciled per-phase breakdown.
const computeCost = computeTokenCostUsd;

export class CostTrackerPlugin implements Middleware {
  readonly name = 'cost';

  private phaseCosts: Array<{ phase: string; cost: number }> = [];
  private totalCost = 0;

  onPhaseTransition(
    fromPhase: string,
    _toPhase: string,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    const tokens = ctx.get<TokenData>('tokens');
    const cache = ctx.get<CacheData>('cache');
    const tokenSnap = tokens?.phaseSnapshots.at(-1);
    const cacheSnap = cache?.phaseSnapshots.at(-1);

    const totalIn = tokenSnap?.inputTokens ?? 0;
    const read = cacheSnap?.cacheReadTokens ?? 0;
    const creation = cacheSnap?.cacheCreationTokens ?? 0;
    const c5m = cacheSnap?.cacheCreation5m ?? 0;
    const c1h = cacheSnap?.cacheCreation1h ?? 0;
    const baseIn = Math.max(0, totalIn - read - creation);

    const phaseCost = computeCost(
      baseIn,
      tokenSnap?.outputTokens ?? 0,
      read,
      c5m,
      c1h,
      creation,
    );

    this.phaseCosts.push({ phase: fromPhase, cost: phaseCost });
    this.totalCost += phaseCost;
    store.set('cost', this.getData());
  }

  onFinalize(
    resultMessage: any,
    _totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    const tokens = ctx.get<TokenData>('tokens');
    const cache = ctx.get<CacheData>('cache');
    const tokenSnap = tokens?.phaseSnapshots.at(-1);
    const cacheSnap = cache?.phaseSnapshots.at(-1);

    const totalIn = tokenSnap?.inputTokens ?? 0;
    const read = cacheSnap?.cacheReadTokens ?? 0;
    const creation = cacheSnap?.cacheCreationTokens ?? 0;
    const c5m = cacheSnap?.cacheCreation5m ?? 0;
    const c1h = cacheSnap?.cacheCreation1h ?? 0;
    const baseIn = Math.max(0, totalIn - read - creation);

    const lastPhaseCost = computeCost(
      baseIn,
      tokenSnap?.outputTokens ?? 0,
      read,
      c5m,
      c1h,
      creation,
    );

    this.phaseCosts.push({ phase: ctx.currentPhase, cost: lastPhaseCost });
    this.totalCost += lastPhaseCost;

    const sdkTotal =
      Number(resultMessage?.usage?.total_cost_usd ?? 0) ||
      Number(resultMessage?.total_cost_usd ?? 0);

    if (sdkTotal > 0 && this.totalCost > 0) {
      const scale = sdkTotal / this.totalCost;
      this.phaseCosts = this.phaseCosts.map((p) => ({
        phase: p.phase,
        cost: p.cost * scale,
      }));
      this.totalCost = sdkTotal;
    }

    store.set('cost', this.getData());
  }

  private getData(): CostData {
    return {
      totalCost: this.totalCost,
      phaseCosts: [...this.phaseCosts],
    };
  }
}
