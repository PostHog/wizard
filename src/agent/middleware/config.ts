/**
 * Benchmark configuration loader.
 *
 * Loads .benchmark-config.json from the working directory with sensible defaults.
 * All fields are optional — missing fields fall back to defaults.
 */

import fs from 'fs';
import path from 'path';
import { logToFile } from '@utils/debug';
import { AgentSignals } from '../agent-interface';
import { runtimeEnv } from '@env';
import { WIZARD_BENCHMARK_FILE } from '@utils/paths';

export interface BenchmarkConfig {
  /** Enable/disable individual metric plugins */
  plugins: Record<string, boolean>;
  output: {
    /** Path for the benchmark JSON output file */
    benchmarkPath: string;
    /** Whether to write the benchmark JSON file */
    benchmarkEnabled: boolean;
    /** Suppress benchmark console output (disables the summary plugin) */
    suppressWizardLogs: boolean;
  };
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  plugins: {
    tokens: true,
    cache: true,
    turns: true,
    compactions: true,
    contextSize: true,
    cost: true,
    duration: true,
    summary: true,
    jsonWriter: true,
  },
  output: {
    benchmarkPath: WIZARD_BENCHMARK_FILE,
    benchmarkEnabled: true,
    suppressWizardLogs: false,
  },
};

export function loadBenchmarkConfig(installDir: string): BenchmarkConfig {
  const configPath =
    runtimeEnv('POSTHOG_WIZARD_BENCHMARK_CONFIG') ??
    path.join(installDir, '.benchmark-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const config: BenchmarkConfig = {
      plugins: { ...DEFAULT_CONFIG.plugins, ...parsed.plugins },
      output: { ...DEFAULT_CONFIG.output, ...parsed.output },
    };

    // Env var overrides for parallel runs
    const benchFile = runtimeEnv('POSTHOG_WIZARD_BENCHMARK_FILE');
    if (benchFile) {
      config.output.benchmarkPath = benchFile;
    }
    // If benchmark output is disabled, disable the jsonWriter plugin
    if (!config.output.benchmarkEnabled) {
      config.plugins.jsonWriter = false;
    }

    logToFile(`${AgentSignals.BENCHMARK} Loaded config from ${configPath}`);
    return config;
  } catch {
    // No config file or invalid JSON — use defaults
    const config = structuredClone(DEFAULT_CONFIG);

    // Env var overrides
    const benchFile2 = runtimeEnv('POSTHOG_WIZARD_BENCHMARK_FILE');
    if (benchFile2) {
      config.output.benchmarkPath = benchFile2;
    }
    return config;
  }
}

export function getDefaultConfig(): BenchmarkConfig {
  return structuredClone(DEFAULT_CONFIG);
}
