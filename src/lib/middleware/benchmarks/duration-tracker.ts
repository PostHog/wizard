/**
 * Duration tracking plugin (per-phase and total).
 */

import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';

export interface DurationData {
  phaseSnapshots: Array<{
    phase: string;
    startTime: number;
    endTime: number;
    durationMs: number;
  }>;
  totalDurationMs: number;
}

export class DurationTrackerPlugin implements Middleware {
  readonly name = 'duration';

  private phaseStartTime = Date.now();
  private phaseSnapshots: Array<{
    phase: string;
    startTime: number;
    endTime: number;
    durationMs: number;
  }> = [];

  onPhaseTransition(
    fromPhase: string,
    _toPhase: string,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    const now = Date.now();
    this.phaseSnapshots.push({
      phase: fromPhase,
      startTime: this.phaseStartTime,
      endTime: now,
      durationMs: now - this.phaseStartTime,
    });
    this.phaseStartTime = now;
    store.set('duration', {
      phaseSnapshots: [...this.phaseSnapshots],
      totalDurationMs: 0,
    } satisfies DurationData);
  }

  onFinalize(
    _resultMessage: any,
    totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    const now = Date.now();
    this.phaseSnapshots.push({
      phase: ctx.currentPhase,
      startTime: this.phaseStartTime,
      endTime: now,
      durationMs: now - this.phaseStartTime,
    });

    store.set('duration', {
      phaseSnapshots: [...this.phaseSnapshots],
      totalDurationMs,
    } satisfies DurationData);
  }
}
