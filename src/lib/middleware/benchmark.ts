/**
 * Benchmark tracking for wizard runs.
 *
 * Usage:
 *   const pipeline = createBenchmarkPipeline(spinner, options);
 *   pipeline.onMessage(message);
 *   pipeline.finalize(resultMessage, durationMs);
 */

import chalk from 'chalk';
import clack from '../../utils/clack';
import { logToFile, getLogFilePath, configureLogFile } from '../../utils/debug';
import { MiddlewarePipeline } from './pipeline';
import { PhaseDetector } from './phase-detector';
import { loadBenchmarkConfig } from './config';
import { createPluginsFromConfig } from './benchmarks';
import type { BenchmarkConfig } from './config';
import type { WizardOptions } from '../../utils/types';
import { AgentSignals } from '../agent-interface';

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
    totalCompactions: number;
  };
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Create a middleware pipeline configured for benchmarking.
 * Loads .benchmark-config.json from the install dir, falls back to defaults.
 */
export function createBenchmarkPipeline(
  spinner: ReturnType<typeof clack.spinner>,
  options: WizardOptions,
  configOverride?: BenchmarkConfig,
): MiddlewarePipeline {
  const config = configOverride ?? loadBenchmarkConfig(options.installDir);

  configureLogFile({
    path: config.output.logPath,
    enabled: config.output.logEnabled,
  });

  const plugins = createPluginsFromConfig(config, {
    spinner,
    phased: false,
    outputPath: config.output.benchmarkPath,
  });

  if (!config.output.suppressWizardLogs) {
    clack.log.info(
      `${chalk.cyan(AgentSignals.BENCHMARK)} Verbose logs: ${getLogFilePath()}`,
    );
    clack.log.info(
      `${chalk.cyan(
        AgentSignals.BENCHMARK,
      )} Benchmark data will be written to: ${config.output.benchmarkPath}`,
    );
  }

  logToFile(
    `${AgentSignals.BENCHMARK} Tracking enabled, starting with setup phase`,
  );

  return new MiddlewarePipeline(plugins, {
    phaseDetector: new PhaseDetector(),
    autoDetectPhases: true,
  });
}
