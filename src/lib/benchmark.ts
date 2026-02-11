/**
 * Benchmark tracking for wizard runs.
 *
 * Detects workflow phase transitions by watching for Read tool calls on
 * workflow files (e.g., basic-integration-1.0-begin.md). Tracks per-phase
 * timing, turns, and token usage. Writes results to a JSON file for CI.
 *
 * Usage in runAgent():
 *   const tracker = options.benchmark ? new BenchmarkTracker() : null;
 *   // in message loop:
 *   tracker?.onMessage(message);
 *   // on success:
 *   const benchmark = tracker?.finalize(resultMessage, durationMs);
 */

import fs from 'fs';
import chalk from 'chalk';
import clack from '../utils/clack';
import { logToFile, LOG_FILE_PATH } from '../utils/debug';

export const BENCHMARK_FILE_PATH = '/tmp/posthog-wizard-benchmark.json';

// ── Types ──────────────────────────────────────────────────────────────

export interface StepUsage {
  name: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage: Record<string, unknown>;
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  contextTokensIn?: number;
  contextTokensOut?: number;
  compactions?: number;
  compactionPreTokens?: number[];
}

export interface BenchmarkData {
  timestamp: string;
  steps: StepUsage[];
  totals: {
    totalCostUsd: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    numTurns: number;
  };
}

// ── Formatting helpers ─────────────────────────────────────────────────

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

// ── Internal helpers ───────────────────────────────────────────────────

/**
 * Sum token usage across all models from the SDK's modelUsage field.
 * modelUsage has per-model aggregates with camelCase field names.
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

/** Regex to detect workflow file references: matches "1.0-begin" from file paths/text */
const WORKFLOW_FILE_RE = /(\d+\.\d+-[a-z]+)(?:\.md)?/;

// ── BenchmarkTracker ───────────────────────────────────────────────────

interface PhaseRecord {
  name: string;
  startTime: number;
  endTime: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  compactions: number;
  compactionPreTokens: number[];
}

/**
 * Observes the SDK message stream and tracks per-phase metrics.
 *
 * Phase transitions are detected by watching for Read tool calls on
 * workflow files (matching the pattern `*-1.0-begin.md`). Everything
 * before the first workflow file is tracked as the "setup" phase.
 */
export class BenchmarkTracker {
  private spinner: ReturnType<typeof clack.spinner>;
  private phases: PhaseRecord[] = [];
  private currentPhase = 'setup';
  private phaseStartTime: number;
  private phaseTurns = 0;
  private phaseInputTokens = 0;
  private phaseOutputTokens = 0;
  private phaseCompactions = 0;
  private phaseCompactionPreTokens: number[] = [];
  private seenPhases = new Set<string>();

  constructor(spinner: ReturnType<typeof clack.spinner>) {
    this.spinner = spinner;
    this.phaseStartTime = Date.now();
    clack.log.info(
      `${chalk.cyan('[BENCHMARK]')} Verbose logs: ${LOG_FILE_PATH}`,
    );
    clack.log.info(
      `${chalk.cyan(
        '[BENCHMARK]',
      )} Benchmark data will be written to: ${BENCHMARK_FILE_PATH}`,
    );
    clack.log.info(
      `${chalk.cyan('[BENCHMARK]')} Starting phase: ${chalk.bold('setup')}`,
    );
    logToFile('[BENCHMARK] Starting phase: setup');
  }

  /**
   * Feed every SDK message into the tracker.
   */
  onMessage(message: any): void {
    if (message.type === 'assistant') {
      this.phaseTurns++;

      // Accumulate per-turn token usage if the API response includes it
      const usage = message.message?.usage;
      if (usage) {
        this.phaseInputTokens += usage.input_tokens ?? 0;
        this.phaseOutputTokens += usage.output_tokens ?? 0;
      }

      // Scan all content blocks for workflow phase references
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          // Detect from text content (agent mentioning/quoting workflow files)
          if (block.type === 'text' && typeof block.text === 'string') {
            this.detectPhaseFromText(block.text);
          }
          // Detect from tool_use blocks (Read tool on workflow files)
          if (block.type === 'tool_use') {
            const filePath = block.input?.file_path ?? block.input?.path ?? '';
            if (typeof filePath === 'string') {
              this.detectPhaseFromText(filePath);
            }
          }
        }
      }
    }

    // Track compaction events (SDK compact_boundary messages)
    if (message.type === 'system' && message.subtype === 'compact_boundary') {
      const preTokens = message.compact_metadata?.pre_tokens ?? 0;
      const trigger = message.compact_metadata?.trigger ?? 'unknown';
      this.phaseCompactions++;
      this.phaseCompactionPreTokens.push(preTokens);
      logToFile(
        `[BENCHMARK] [COMPACTION] Context compacted during "${
          this.currentPhase
        }" (trigger: ${trigger}, pre_tokens: ${formatTokenCount(preTokens)})`,
      );
      clack.log.info(
        `${chalk.yellow('[COMPACTION]')} Context compacted during "${
          this.currentPhase
        }" (trigger: ${trigger}, pre_tokens: ${formatTokenCount(preTokens)})`,
      );
    }
  }

  private detectPhaseFromText(text: string): void {
    const match = text.match(WORKFLOW_FILE_RE);
    if (match && !this.seenPhases.has(match[1])) {
      this.transitionTo(match[1]);
    }
  }

  /**
   * Close tracking and build the final BenchmarkData.
   * Call this when the agent result message is received.
   */
  finalize(resultMessage: any, totalDurationMs: number): BenchmarkData {
    // Close the current (last) phase
    this.closeCurrentPhase();

    // Build per-phase StepUsage from tracked phases + aggregate from result
    const modelUsage = resultMessage?.modelUsage ?? {};
    const aggregateUsage = sumModelUsage(modelUsage);
    const lastCallUsage = resultMessage?.usage ?? {};
    const contextTokensOut =
      Number(lastCallUsage.input_tokens ?? 0) +
      Number(lastCallUsage.cache_read_input_tokens ?? 0) +
      Number(lastCallUsage.cache_creation_input_tokens ?? 0);

    const totalTurns = this.phases.reduce((s, p) => s + p.turns, 0);
    const totalCost = resultMessage?.total_cost_usd ?? 0;

    const steps: StepUsage[] = this.phases.map((phase) => ({
      name: phase.name,
      // Per-phase token usage from assistant message usage fields
      usage: {
        input_tokens: phase.inputTokens,
        output_tokens: phase.outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      // Proportional cost estimate based on turns
      totalCostUsd: totalTurns > 0 ? totalCost * (phase.turns / totalTurns) : 0,
      durationMs: phase.endTime - phase.startTime,
      durationApiMs: 0,
      numTurns: phase.turns,
      ...(phase.compactions > 0 && {
        compactions: phase.compactions,
        compactionPreTokens: phase.compactionPreTokens,
      }),
    }));

    // Stamp context size on the last step
    if (steps.length > 0) {
      steps[steps.length - 1].contextTokensOut = contextTokensOut;
    }

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
      },
    };

    // Log summary
    const totalDurationStr = formatDuration(totalDurationMs);
    clack.log.success(
      `${chalk.cyan('[BENCHMARK]')} ${
        this.phases.length
      } phases completed in ${totalDurationStr}, cost: $${totalCost.toFixed(
        4,
      )}`,
    );
    clack.log.info(
      `${chalk.cyan('[BENCHMARK]')} Results written to ${BENCHMARK_FILE_PATH}`,
    );

    writeBenchmarkData(benchmark);
    return benchmark;
  }

  // ── Private ────────────────────────────────────────────────────────

  private transitionTo(newPhase: string): void {
    // Stop spinner so log output is visible
    this.spinner.stop(
      `${chalk.cyan('[BENCHMARK]')} Completed phase: ${chalk.bold(
        this.currentPhase,
      )} ${chalk.dim(`(${this.formatPhaseStats()})`)}`,
    );
    this.closeCurrentPhase();

    this.seenPhases.add(newPhase);
    this.currentPhase = newPhase;
    this.phaseStartTime = Date.now();
    this.phaseTurns = 0;
    this.phaseInputTokens = 0;
    this.phaseOutputTokens = 0;
    this.phaseCompactions = 0;
    this.phaseCompactionPreTokens = [];

    clack.log.info(
      `${chalk.cyan('[BENCHMARK]')} Starting phase: ${chalk.bold(newPhase)}`,
    );
    logToFile(`[BENCHMARK] Starting phase: ${newPhase}`);

    // Restart spinner
    this.spinner.start(`Integrating PostHog (${newPhase})...`);
  }

  private closeCurrentPhase(): void {
    const now = Date.now();

    this.phases.push({
      name: this.currentPhase,
      startTime: this.phaseStartTime,
      endTime: now,
      turns: this.phaseTurns,
      inputTokens: this.phaseInputTokens,
      outputTokens: this.phaseOutputTokens,
      compactions: this.phaseCompactions,
      compactionPreTokens: [...this.phaseCompactionPreTokens],
    });

    logToFile(
      `[BENCHMARK] Completed phase: ${
        this.currentPhase
      } (${this.formatPhaseStats()})`,
    );
  }

  private formatPhaseStats(): string {
    const duration = Date.now() - this.phaseStartTime;
    const parts = [formatDuration(duration), `${this.phaseTurns} turns`];
    if (this.phaseInputTokens > 0 || this.phaseOutputTokens > 0) {
      parts.push(
        `in: ${formatTokenCount(this.phaseInputTokens)}`,
        `out: ${formatTokenCount(this.phaseOutputTokens)}`,
      );
    }
    if (this.phaseCompactions > 0) {
      parts.push(`${this.phaseCompactions} compaction(s)`);
    }
    return parts.join(', ');
  }
}

// ── File I/O ───────────────────────────────────────────────────────────

/**
 * Write benchmark data to the benchmark file.
 */
export function writeBenchmarkData(data: BenchmarkData): void {
  try {
    fs.writeFileSync(BENCHMARK_FILE_PATH, JSON.stringify(data, null, 2));
    logToFile(`Benchmark data written to ${BENCHMARK_FILE_PATH}`);
  } catch (error) {
    logToFile('Failed to write benchmark data:', error);
  }
}
