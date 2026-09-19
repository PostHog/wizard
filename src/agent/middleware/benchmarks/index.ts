/**
 * Plugin registry and factory.
 *
 * Maps plugin names to constructors and creates the ordered plugin list
 * from a BenchmarkConfig.
 */

import type { Middleware, MiddlewareFactoryOptions } from '../types.js';
import type { BenchmarkConfig } from '../config.js';
import { TurnCounterPlugin } from './turn-counter.js';
import { TokenTrackerPlugin } from './token-tracker.js';
import { CacheTrackerPlugin } from './cache-tracker.js';
import { CompactionTrackerPlugin } from './compaction-tracker.js';
import { ContextSizeTrackerPlugin } from './context-size-tracker.js';
import { CostTrackerPlugin } from './cost-tracker.js';
import { DurationTrackerPlugin } from './duration-tracker.js';
import { SummaryPlugin } from './summary.js';
import { JsonWriterPlugin } from './json-writer.js';

type PluginFactory = (opts: MiddlewareFactoryOptions) => Middleware;

const PLUGIN_REGISTRY: Record<string, PluginFactory> = {
  turns: () => new TurnCounterPlugin(),
  tokens: () => new TokenTrackerPlugin(),
  cache: () => new CacheTrackerPlugin(),
  compactions: () => new CompactionTrackerPlugin(),
  contextSize: () => new ContextSizeTrackerPlugin(),
  cost: () => new CostTrackerPlugin(),
  duration: () => new DurationTrackerPlugin(),
  summary: (opts) => new SummaryPlugin(opts.spinner!),
  jsonWriter: (opts) => new JsonWriterPlugin(opts.outputPath!),
};

/**
 * Execution order — data producers before consumers:
 * turns (dedup) -> tokens -> cache -> compactions -> contextSize -> cost -> duration -> summary -> jsonWriter
 */
const PLUGIN_ORDER = [
  'turns',
  'tokens',
  'cache',
  'compactions',
  'contextSize',
  'cost',
  'duration',
  'summary',
  'jsonWriter',
];

export function createPluginsFromConfig(
  config: BenchmarkConfig,
  opts: MiddlewareFactoryOptions,
): Middleware[] {
  const resolvedOpts: MiddlewareFactoryOptions = {
    ...opts,
    outputPath: opts.outputPath ?? config.output.benchmarkPath,
  };

  // If suppressWizardLogs is set, disable the summary plugin
  const effectivePlugins = { ...config.plugins };
  if (config.output.suppressWizardLogs) {
    effectivePlugins.summary = false;
  }

  return PLUGIN_ORDER.filter((name) => effectivePlugins[name] !== false)
    .map((name) => PLUGIN_REGISTRY[name])
    .filter(Boolean)
    .map((factory) => factory(resolvedOpts));
}
