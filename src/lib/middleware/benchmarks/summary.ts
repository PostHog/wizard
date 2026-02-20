/**
 * Console summary plugin — prints benchmark phase-by-phase results.
 */

import chalk from 'chalk';
import clack from '../../../utils/clack';
import { AgentSignals } from '../../agent-interface';
import type { Middleware, MiddlewareContext, MiddlewareStore } from '../types';
import type { TokenData } from './token-tracker';
import type { TurnData } from './turn-counter';
import type { CostData } from './cost-tracker';
import type { DurationData } from './duration-tracker';
import type { CompactionData } from './compaction-tracker';
import type { ContextSizeData } from './context-size-tracker';

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}K`;
  return tokens.toLocaleString();
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export class SummaryPlugin implements Middleware {
  readonly name = 'summary';

  private spinner: ReturnType<typeof clack.spinner>;

  constructor(spinner: ReturnType<typeof clack.spinner>) {
    this.spinner = spinner;
  }

  onPhaseTransition(
    fromPhase: string,
    toPhase: string,
    ctx: MiddlewareContext,
    _store: MiddlewareStore,
  ): void {
    const tokens = ctx.get<TokenData>('tokens');
    const turns = ctx.get<TurnData>('turns');
    const cost = ctx.get<CostData>('cost');
    const duration = ctx.get<DurationData>('duration');
    const compactions = ctx.get<CompactionData>('compactions');
    const contextSize = ctx.get<ContextSizeData>('contextSize');

    // Build per-phase summary from the latest snapshot
    const durSnap = duration?.phaseSnapshots.at(-1);
    const turnSnap = turns?.phaseSnapshots.at(-1);
    const tokenSnap = tokens?.phaseSnapshots.at(-1);
    const costSnap = cost?.phaseCosts.at(-1);
    const compSnap = compactions?.phaseSnapshots.at(-1);
    const ctxSnap = contextSize?.phaseSnapshots.at(-1);

    const parts = [
      durSnap ? formatDuration(durSnap.durationMs) : '',
      `${turnSnap?.turns ?? 0} turns`,
      `in: ${formatTokenCount(tokenSnap?.inputTokens ?? 0)}`,
      `out: ${formatTokenCount(tokenSnap?.outputTokens ?? 0)}`,
      `cost: ${formatCost(costSnap?.cost ?? 0)}`,
    ];

    if (ctxSnap?.contextTokensIn !== undefined) {
      parts.push(`ctx in: ${formatTokenCount(ctxSnap.contextTokensIn)}`);
    }
    if (ctxSnap?.contextTokensOut !== undefined) {
      parts.push(`ctx out: ${formatTokenCount(ctxSnap.contextTokensOut)}`);
    }

    if (compSnap && compSnap.compactions > 0) {
      parts.push(`${compSnap.compactions} compaction(s)`);
    }

    this.spinner.stop(
      `${chalk.cyan(AgentSignals.BENCHMARK)} ${chalk.bold(fromPhase)}: ${parts
        .filter(Boolean)
        .join(', ')}`,
    );
    clack.log.info(
      `${chalk.cyan(AgentSignals.BENCHMARK)} Starting phase: ${chalk.bold(
        toPhase,
      )}`,
    );
    this.spinner.start(`Integrating PostHog (${toPhase})...`);
  }

  onFinalize(
    _resultMessage: any,
    totalDurationMs: number,
    ctx: MiddlewareContext,
    _store: MiddlewareStore,
  ): void {
    const tokens = ctx.get<TokenData>('tokens');
    const turns = ctx.get<TurnData>('turns');
    const cost = ctx.get<CostData>('cost');
    const duration = ctx.get<DurationData>('duration');
    const compactions = ctx.get<CompactionData>('compactions');
    const contextSize = ctx.get<ContextSizeData>('contextSize');

    const phaseCount = duration?.phaseSnapshots.length ?? 0;
    const totalCost = cost?.totalCost ?? 0;
    const totalDurationStr = formatDuration(totalDurationMs);

    clack.log.info('');
    clack.log.info(
      `${chalk.green('◇')} ${chalk.cyan(
        AgentSignals.BENCHMARK,
      )} ${phaseCount} phases completed in ${totalDurationStr}, cost: ${formatCost(
        totalCost,
      )}`,
    );
    clack.log.info(
      `${chalk.blue('●')} ${chalk.cyan(
        AgentSignals.BENCHMARK,
      )} Summary by phase:`,
    );

    if (duration?.phaseSnapshots) {
      for (let i = 0; i < duration.phaseSnapshots.length; i++) {
        const dur = duration.phaseSnapshots[i];
        const turnSnap = turns?.phaseSnapshots[i];
        const tokenSnap = tokens?.phaseSnapshots[i];
        const costSnap = cost?.phaseCosts[i];
        const compSnap = compactions?.phaseSnapshots[i];
        const ctxSnap = contextSize?.phaseSnapshots[i];

        const parts = [
          dur.phase,
          formatDuration(dur.durationMs),
          `${turnSnap?.turns ?? 0} turns`,
          `in: ${formatTokenCount(tokenSnap?.inputTokens ?? 0)}`,
          `out: ${formatTokenCount(tokenSnap?.outputTokens ?? 0)}`,
          `cost: ${formatCost(costSnap?.cost ?? 0)}`,
        ];

        if (ctxSnap?.contextTokensIn !== undefined) {
          parts.push(`ctx in: ${formatTokenCount(ctxSnap.contextTokensIn)}`);
        }
        if (ctxSnap?.contextTokensOut !== undefined) {
          parts.push(`ctx out: ${formatTokenCount(ctxSnap.contextTokensOut)}`);
        }

        if (compSnap && compSnap.compactions > 0) {
          parts.push(
            `${compSnap.compactions} compaction(s) (pre: ${compSnap.preTokens
              .map((t) => formatTokenCount(t))
              .join(', ')})`,
          );
        } else {
          parts.push('0 compactions');
        }

        clack.log.info(`${chalk.dim('  •')} ${parts.join(', ')}`);
      }
    }

    clack.log.info('');
  }
}
