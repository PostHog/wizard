/**
 * Compaction event tracking plugin.
 *
 * Tracks context compaction events (compact_boundary system messages)
 * including pre-compaction token counts per phase.
 */

import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';
import { logToFile } from '../../../utils/debug';
import { AgentSignals } from '../../agent-interface';

export interface CompactionData {
  phaseCompactions: number;
  phasePreTokens: number[];
  totalCompactions: number;
  phaseSnapshots: Array<{
    phase: string;
    compactions: number;
    preTokens: number[];
  }>;
}

export class CompactionTrackerPlugin implements Middleware {
  readonly name = 'compactions';

  private phaseCompactions = 0;
  private phasePreTokens: number[] = [];
  private totalCompactions = 0;
  private phaseSnapshots: Array<{
    phase: string;
    compactions: number;
    preTokens: number[];
  }> = [];
  private currentPhase = 'setup';

  onMessage(
    message: any,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    if (message.type !== 'system' || message.subtype !== 'compact_boundary') {
      return;
    }

    const preTokens = message.compact_metadata?.pre_tokens ?? 0;
    const trigger = message.compact_metadata?.trigger ?? 'unknown';
    this.phaseCompactions++;
    this.totalCompactions++;
    this.phasePreTokens.push(preTokens);

    logToFile(
      `${AgentSignals.BENCHMARK} [COMPACTION] Context compacted during "${ctx.currentPhase}" (trigger: ${trigger}, pre_tokens: ${preTokens})`,
    );

    store.set('compactions', this.getData());
  }

  onPhaseTransition(
    fromPhase: string,
    toPhase: string,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: fromPhase,
      compactions: this.phaseCompactions,
      preTokens: [...this.phasePreTokens],
    });
    this.currentPhase = toPhase;
    this.phaseCompactions = 0;
    this.phasePreTokens = [];
    store.set('compactions', this.getData());
  }

  onFinalize(
    _resultMessage: any,
    _totalDurationMs: number,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push({
      phase: this.currentPhase,
      compactions: this.phaseCompactions,
      preTokens: [...this.phasePreTokens],
    });
    store.set('compactions', this.getData());
  }

  private getData(): CompactionData {
    return {
      phaseCompactions: this.phaseCompactions,
      phasePreTokens: [...this.phasePreTokens],
      totalCompactions: this.totalCompactions,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
