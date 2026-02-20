/**
 * Benchmark configuration loader.
 *
 * Loads .benchmark-config.json from the working directory with sensible defaults.
 * All fields are optional — missing fields fall back to defaults.
 */

import fs from 'fs';
import path from 'path';
import { logToFile } from '../../utils/debug';
import { AgentSignals } from '../agent-interface';

export interface BenchmarkConfig {
  /** Enable/disable individual metric plugins */
  plugins: Record<string, boolean>;
  output: {
    /** Path for the benchmark JSON output file */
    benchmarkPath: string;
    /** Whether to write the benchmark JSON file */
    benchmarkEnabled: boolean;
    /** Path for the main wizard debug log file */
    logPath: string;
    /** Whether to write the main wizard debug log */
    logEnabled: boolean;
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
    benchmarkPath: '/tmp/posthog-wizard-benchmark.json',
    benchmarkEnabled: true,
    logPath: '/tmp/posthog-wizard.log',
    logEnabled: true,
    suppressWizardLogs: false,
  },
};

export function loadBenchmarkConfig(installDir: string): BenchmarkConfig {
  const configPath =
    process.env.POSTHOG_WIZARD_BENCHMARK_CONFIG ??
    path.join(installDir, '.benchmark-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const config: BenchmarkConfig = {
      plugins: { ...DEFAULT_CONFIG.plugins, ...parsed.plugins },
      output: { ...DEFAULT_CONFIG.output, ...parsed.output },
    };

    // Env var overrides for parallel runs
    if (process.env.POSTHOG_WIZARD_BENCHMARK_FILE) {
      config.output.benchmarkPath = process.env.POSTHOG_WIZARD_BENCHMARK_FILE;
    }
    if (process.env.POSTHOG_WIZARD_LOG_FILE) {
      config.output.logPath = process.env.POSTHOG_WIZARD_LOG_FILE;
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
    if (process.env.POSTHOG_WIZARD_BENCHMARK_FILE) {
      config.output.benchmarkPath = process.env.POSTHOG_WIZARD_BENCHMARK_FILE;
    }
    if (process.env.POSTHOG_WIZARD_LOG_FILE) {
      config.output.logPath = process.env.POSTHOG_WIZARD_LOG_FILE;
    }

    return config;
  }
}

export function getDefaultConfig(): BenchmarkConfig {
  return structuredClone(DEFAULT_CONFIG);
}
