import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';
import type { TokenData } from './token-tracker';
import type { CacheData } from './cache-tracker';

export interface CostData {
  totalCost: number;
  phaseCosts: Array<{ phase: string; cost: number }>;
}

/** Claude Sonnet 4.6 pricing (USD per 1M tokens) */
const PRICE_PER_MTOK = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheCreation5m: 3.75,
  cacheCreation1h: 6,
} as const;

function computeCost(
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
