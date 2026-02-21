/**
 * Plugin registry and factory.
 *
 * Maps plugin names to constructors and creates the ordered plugin list
 * from a BenchmarkConfig.
 */

import type { Middleware, MiddlewareFactoryOptions } from '../types';
import type { BenchmarkConfig } from '../config';
import { TurnCounterPlugin } from './turn-counter';
import { TokenTrackerPlugin } from './token-tracker';
import { CacheTrackerPlugin } from './cache-tracker';
import { CompactionTrackerPlugin } from './compaction-tracker';
import { ContextSizeTrackerPlugin } from './context-size-tracker';
import { CostTrackerPlugin } from './cost-tracker';
import { DurationTrackerPlugin } from './duration-tracker';
import { SummaryPlugin } from './summary';
import { JsonWriterPlugin } from './json-writer';

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
