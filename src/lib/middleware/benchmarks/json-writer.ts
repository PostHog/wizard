/**
 * JSON file output plugin.
 *
 * Assembles the BenchmarkData structure from all upstream plugin data
 * and writes it to a JSON file. Returns the BenchmarkData for backward compat.
 */

import fs from 'fs';
import clack from '../../../utils/clack';
import chalk from 'chalk';
import { logToFile } from '../../../utils/debug';
import { AgentSignals } from '../../agent-interface';
import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';
import type { TokenData } from './token-tracker';
import type { CacheData } from './cache-tracker';
import type { TurnData } from './turn-counter';
import type { CostData } from './cost-tracker';
import type { DurationData } from './duration-tracker';
import type { CompactionData } from './compaction-tracker';
import type { ContextSizeData } from './context-size-tracker';
import type { BenchmarkData, StepUsage } from '../benchmark';

/**
 * Sum token usage across all models from the SDK's modelUsage field.
 */
function sumModelUsage(modelUsage: Record<string, any>): {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
} {
  let input_tokens = 0;
  let output_tokens = 0;
  let cache_creation_input_tokens = 0;
  let cache_read_input_tokens = 0;

  for (const model of Object.values(modelUsage)) {
    input_tokens += model.inputTokens ?? 0;
    output_tokens += model.outputTokens ?? 0;
    cache_creation_input_tokens += model.cacheCreationInputTokens ?? 0;
    cache_read_input_tokens += model.cacheReadInputTokens ?? 0;
  }

  return {
    input_tokens,
    output_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
  };
}

export class JsonWriterPlugin implements Middleware {
  readonly name = 'jsonWriter';

  private outputPath: string;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
  }

  onFinalize(
    resultMessage: any,
    totalDurationMs: number,
    ctx: MiddlewareContext,
    _store: MiddlewareStore,
  ): BenchmarkData {
    const tokens = ctx.get<TokenData>('tokens');
    const cache = ctx.get<CacheData>('cache');
    const turns = ctx.get<TurnData>('turns');
    const cost = ctx.get<CostData>('cost');
    const duration = ctx.get<DurationData>('duration');
    const compactions = ctx.get<CompactionData>('compactions');
    const contextSize = ctx.get<ContextSizeData>('contextSize');

    const modelUsage = resultMessage?.modelUsage ?? {};
    const aggregateUsage = sumModelUsage(modelUsage);

    const phaseCount = duration?.phaseSnapshots.length ?? 0;
    const steps: StepUsage[] = [];

    for (let i = 0; i < phaseCount; i++) {
      const dur = duration!.phaseSnapshots[i];
      const tokenSnap = tokens?.phaseSnapshots[i];
      const cacheSnap = cache?.phaseSnapshots[i];
      const turnSnap = turns?.phaseSnapshots[i];
      const costSnap = cost?.phaseCosts[i];
      const compSnap = compactions?.phaseSnapshots[i];
      const ctxSnap = contextSize?.phaseSnapshots[i];

      const step: StepUsage = {
        name: dur.phase,
        usage: {
          input_tokens: tokenSnap?.inputTokens ?? 0,
          output_tokens: tokenSnap?.outputTokens ?? 0,
          cache_creation_input_tokens: cacheSnap?.cacheCreationTokens ?? 0,
          cache_read_input_tokens: cacheSnap?.cacheReadTokens ?? 0,
        },
        modelUsage: {},
        totalCostUsd: costSnap?.cost ?? 0,
        durationMs: dur.durationMs,
        durationApiMs: 0,
        numTurns: turnSnap?.turns ?? 0,
        ...(ctxSnap?.contextTokensIn !== undefined && {
          contextTokensIn: ctxSnap.contextTokensIn,
        }),
        ...(ctxSnap?.contextTokensOut !== undefined && {
          contextTokensOut: ctxSnap.contextTokensOut,
        }),
        ...(compSnap && compSnap.compactions > 0
          ? {
              compactions: compSnap.compactions,
              compactionPreTokens: compSnap.preTokens,
            }
          : {}),
      };

      steps.push(step);
    }

    const totalTurns = turns?.totalTurns ?? 0;
    const totalCost = cost?.totalCost ?? 0;
    const totalCompactions = compactions?.totalCompactions ?? 0;

    const benchmark: BenchmarkData = {
      timestamp: new Date().toISOString(),
      steps,
      totals: {
        totalCostUsd: totalCost,
        durationMs: totalDurationMs,
        inputTokens:
          aggregateUsage.input_tokens +
          aggregateUsage.cache_read_input_tokens +
          aggregateUsage.cache_creation_input_tokens,
        outputTokens: aggregateUsage.output_tokens,
        numTurns: resultMessage?.num_turns ?? totalTurns,
        totalCompactions,
      },
    };

    this.writeBenchmarkData(benchmark);
    return benchmark;
  }

  private writeBenchmarkData(data: BenchmarkData): void {
    try {
      fs.writeFileSync(this.outputPath, JSON.stringify(data, null, 2));
      logToFile(`Benchmark data written to ${this.outputPath}`);
      clack.log.info(
        `${chalk.blue('●')} ${chalk.cyan(
          AgentSignals.BENCHMARK,
        )} Results written to ${this.outputPath}`,
      );
    } catch (error) {
      logToFile('Failed to write benchmark data:', error);
    }
  }
}
