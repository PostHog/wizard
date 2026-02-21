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
import type { CacheData } from './cache-tracker';

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

interface PhaseStats {
  phase: string;
  durationMs: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  cost: number;
  compactions: number;
  contextOut: number | undefined;
}

function printPhase(s: PhaseStats): string {
  const baseIn = Math.max(
    0,
    s.inputTokens - s.cacheRead - s.cacheCreation5m - s.cacheCreation1h,
  );
  return [
    `${chalk.bold(s.phase)}: ${fmtDuration(s.durationMs)}, ${
      s.turns
    } turns, cost: ${fmtCost(s.cost)}`,
    `  in: ${fmtTok(baseIn)}, out: ${fmtTok(
      s.outputTokens,
    )}, cache_read: ${fmtTok(s.cacheRead)}, cache_5m: ${fmtTok(
      s.cacheCreation5m,
    )}, cache_1h: ${fmtTok(s.cacheCreation1h)}`,
    s.compactions > 0 ? `  ${s.compactions} compaction(s)` : null,
    s.contextOut !== undefined ? `  ctx_out: ${fmtTok(s.contextOut)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function getPhaseStats(i: number, ctx: MiddlewareContext): PhaseStats | null {
  const duration = ctx.get<DurationData>('duration');
  const dur = duration?.phaseSnapshots[i];
  if (!dur) return null;

  const tokens = ctx.get<TokenData>('tokens');
  const turns = ctx.get<TurnData>('turns');
  const cost = ctx.get<CostData>('cost');
  const compactions = ctx.get<CompactionData>('compactions');
  const contextSize = ctx.get<ContextSizeData>('contextSize');
  const cache = ctx.get<CacheData>('cache');

  return {
    phase: dur.phase,
    durationMs: dur.durationMs,
    turns: turns?.phaseSnapshots[i]?.turns ?? 0,
    inputTokens: tokens?.phaseSnapshots[i]?.inputTokens ?? 0,
    outputTokens: tokens?.phaseSnapshots[i]?.outputTokens ?? 0,
    cacheRead: cache?.phaseSnapshots[i]?.cacheReadTokens ?? 0,
    cacheCreation5m: cache?.phaseSnapshots[i]?.cacheCreation5m ?? 0,
    cacheCreation1h: cache?.phaseSnapshots[i]?.cacheCreation1h ?? 0,
    cost: cost?.phaseCosts[i]?.cost ?? 0,
    compactions: compactions?.phaseSnapshots[i]?.compactions ?? 0,
    contextOut: contextSize?.phaseSnapshots[i]?.contextTokensOut,
  };
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
    const duration = ctx.get<DurationData>('duration');
    const idx = (duration?.phaseSnapshots.length ?? 1) - 1;
    const stats = getPhaseStats(idx, ctx);

    if (stats) {
      this.spinner.stop(
        `${chalk.cyan(AgentSignals.BENCHMARK)} ${printPhase(stats)}`,
      );
    } else {
      this.spinner.stop(`${chalk.cyan(AgentSignals.BENCHMARK)} ${fromPhase}`);
    }

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
    const duration = ctx.get<DurationData>('duration');
    const cost = ctx.get<CostData>('cost');
    const tokens = ctx.get<TokenData>('tokens');
    const cache = ctx.get<CacheData>('cache');

    const phaseCount = duration?.phaseSnapshots.length ?? 0;
    const totalCost = cost?.totalCost ?? 0;

    clack.log.info('');
    clack.log.info(
      `${chalk.green('◇')} ${chalk.cyan(
        AgentSignals.BENCHMARK,
      )} ${phaseCount} phases in ${fmtDuration(
        totalDurationMs,
      )}, cost: ${fmtCost(totalCost)}`,
    );
    clack.log.info(
      `  total in: ${fmtTok(tokens?.totalInput ?? 0)}, out: ${fmtTok(
        tokens?.totalOutput ?? 0,
      )}, cache_read: ${fmtTok(cache?.totalRead ?? 0)}, cache_5m: ${fmtTok(
        cache?.totalCreation5m ?? 0,
      )}, cache_1h: ${fmtTok(cache?.totalCreation1h ?? 0)}`,
    );
    clack.log.info('');
    clack.log.info(
      `${chalk.blue('●')} ${chalk.cyan(
        AgentSignals.BENCHMARK,
      )} Summary by phase:`,
    );

    if (duration?.phaseSnapshots) {
      for (let i = 0; i < duration.phaseSnapshots.length; i++) {
        const stats = getPhaseStats(i, ctx);
        if (stats) {
          clack.log.info(printPhase(stats));
        }
      }
    }

    clack.log.info('');
  }
}
