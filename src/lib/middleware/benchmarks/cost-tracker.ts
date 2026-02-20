/**
 * Cost tracking plugin.
 *
 * In phased mode, cost is extracted per-phase from previousResult.total_cost_usd.
 * In non-phased mode, cost is taken from the final result and distributed
 * proportionally by turn count.
 */

import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';
import type { TurnData } from './turn-counter';

export interface CostData {
  totalCost: number;
  phaseCosts: Array<{ phase: string; cost: number }>;
}

export class CostTrackerPlugin implements Middleware {
  readonly name = 'cost';

  private phased: boolean;

  constructor(opts?: { phased?: boolean }) {
    this.phased = opts?.phased ?? false;
  }

  onFinalize(
    resultMessage: any,
    _totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    const turns = ctx.get<TurnData>('turns');
    const totalCost = Number(resultMessage?.total_cost_usd ?? 0);

    // Distribute cost across phases proportionally by turn count
    const phaseCosts: Array<{ phase: string; cost: number }> = [];
    const totalTurns = turns?.totalTurns ?? 0;

    if (turns?.phaseSnapshots) {
      for (const snap of turns.phaseSnapshots) {
        const phaseCost =
          totalTurns > 0 ? totalCost * (snap.turns / totalTurns) : 0;
        phaseCosts.push({ phase: snap.phase, cost: phaseCost });
      }
    }

    store.set('cost', { totalCost, phaseCosts } satisfies CostData);
  }
}
