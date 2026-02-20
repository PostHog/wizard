/**
 * Token tracking plugin for input/output tokens.
 *
 * Accumulates per-turn token usage, respecting the dedup flag from TurnCounterPlugin.
 * Publishes running totals and per-phase snapshots.
 */

import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';
import type { TurnData } from './turn-counter';

export interface TokenData {
  phaseInput: number;
  phaseOutput: number;
  totalInput: number;
  totalOutput: number;
  /** The raw usage object from the last non-duplicate assistant message */
  lastUsage: any;
  /** Per-phase token snapshots */
  phaseSnapshots: Array<{
    phase: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

export class TokenTrackerPlugin implements Middleware {
  readonly name = 'tokens';

  private phaseInput = 0;
  private phaseOutput = 0;
  private totalInput = 0;
  private totalOutput = 0;
  private lastUsage: any = null;
  private phaseSnapshots: Array<{
    phase: string;
    inputTokens: number;
    outputTokens: number;
  }> = [];
  private currentPhase = 'setup';

  onMessage(
    message: any,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    if (message.type !== 'assistant') return;

    const turns = ctx.get<TurnData>('turns');
    if (turns?.isDuplicate) return;

    const usage = message.message?.usage;
    if (usage) {
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      this.phaseInput += input;
      this.phaseOutput += output;
      this.totalInput += input;
      this.totalOutput += output;
      this.lastUsage = usage;
    }

    store.set('tokens', this.getData());
  }

  onPhaseTransition(
    fromPhase: string,
    toPhase: string,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: fromPhase,
      inputTokens: this.phaseInput,
      outputTokens: this.phaseOutput,
    });
    this.currentPhase = toPhase;
    this.phaseInput = 0;
    this.phaseOutput = 0;
    store.set('tokens', this.getData());
  }

  onFinalize(
    _resultMessage: any,
    _totalDurationMs: number,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: this.currentPhase,
      inputTokens: this.phaseInput,
      outputTokens: this.phaseOutput,
    });
    store.set('tokens', this.getData());
  }

  private getData(): TokenData {
    return {
      phaseInput: this.phaseInput,
      phaseOutput: this.phaseOutput,
      totalInput: this.totalInput,
      totalOutput: this.totalOutput,
      lastUsage: this.lastUsage,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
