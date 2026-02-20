/**
 * Cache token tracking plugin (cache_read and cache_creation).
 *
 * Respects the dedup flag from TurnCounterPlugin.
 */

import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';
import type { TurnData } from './turn-counter';

export interface CacheData {
  phaseRead: number;
  phaseCreation: number;
  totalRead: number;
  totalCreation: number;
  phaseSnapshots: Array<{
    phase: string;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  }>;
}

export class CacheTrackerPlugin implements Middleware {
  readonly name = 'cache';

  private phaseRead = 0;
  private phaseCreation = 0;
  private totalRead = 0;
  private totalCreation = 0;
  private phaseSnapshots: Array<{
    phase: string;
    cacheReadTokens: number;
    cacheCreationTokens: number;
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
      const read = usage.cache_read_input_tokens ?? 0;
      const creation = usage.cache_creation_input_tokens ?? 0;
      this.phaseRead += read;
      this.phaseCreation += creation;
      this.totalRead += read;
      this.totalCreation += creation;
    }

    store.set('cache', this.getData());
  }

  onPhaseTransition(
    fromPhase: string,
    toPhase: string,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: fromPhase,
      cacheReadTokens: this.phaseRead,
      cacheCreationTokens: this.phaseCreation,
    });
    this.currentPhase = toPhase;
    this.phaseRead = 0;
    this.phaseCreation = 0;
    store.set('cache', this.getData());
  }

  onFinalize(
    _resultMessage: any,
    _totalDurationMs: number,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: this.currentPhase,
      cacheReadTokens: this.phaseRead,
      cacheCreationTokens: this.phaseCreation,
    });
    store.set('cache', this.getData());
  }

  private getData(): CacheData {
    return {
      phaseRead: this.phaseRead,
      phaseCreation: this.phaseCreation,
      totalRead: this.totalRead,
      totalCreation: this.totalCreation,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
