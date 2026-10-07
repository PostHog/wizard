/**
 * Turn counting plugin with message deduplication.
 *
 * The SDK emits multiple assistant events per turn (one per content block)
 * with the same message ID. This plugin deduplicates and publishes turn
 * counts + a duplicate flag for downstream plugins.
 */

import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';

export interface TurnData {
  /** Whether the current message is a duplicate of the last processed turn */
  isDuplicate: boolean;
  /** Turns in the current phase */
  phaseTurns: number;
  /** Total turns across all phases */
  totalTurns: number;
  /** Per-phase turn snapshots: [{ phase, turns }] */
  phaseSnapshots: Array<{ phase: string; turns: number }>;
}

export class TurnCounterPlugin implements Middleware {
  readonly name = 'turns';

  private lastMessageId: string | null = null;
  private phaseTurns = 0;
  private totalTurns = 0;
  private isDuplicate = false;
  private phaseSnapshots: Array<{ phase: string; turns: number }> = [];
  private currentPhase = 'setup';

  onMessage(
    message: any,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    if (message.type !== 'assistant') {
      this.isDuplicate = false;
      store.set('turns', this.getData());
      return;
    }

    const msgId: string | undefined = message.message?.id;
    this.isDuplicate = msgId != null && msgId === this.lastMessageId;
    if (msgId) this.lastMessageId = msgId;

    if (!this.isDuplicate) {
      this.phaseTurns++;
      this.totalTurns++;
    }

    store.set('turns', this.getData());
  }

  onPhaseTransition(
    fromPhase: string,
    _toPhase: string,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({ phase: fromPhase, turns: this.phaseTurns });
    this.currentPhase = _toPhase;
    this.phaseTurns = 0;
    this.lastMessageId = null;
    store.set('turns', this.getData());
  }

  onFinalize(
    _resultMessage: any,
    _totalDurationMs: number,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: this.currentPhase,
      turns: this.phaseTurns,
    });
    store.set('turns', this.getData());
  }

  private getData(): TurnData {
    return {
      isDuplicate: this.isDuplicate,
      phaseTurns: this.phaseTurns,
      totalTurns: this.totalTurns,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
