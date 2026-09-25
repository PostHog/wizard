import { metricsConfig } from '@lib/programs/metrics/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard metrics` — flat skill command, wire PostHog application metrics
 * (counters, gauges, histograms via \`posthog.metrics\`) into a project.
 *
 * The `metrics` context-mill skill has one variant per platform (python,
 * nodejs, javascript, kubernetes, other/OTLP); the agent picks the right one
 * at run time by scanning the project's manifest and (when ambiguous) asking
 * the user via `wizard_ask`. Stays flat while a single "add metrics to a
 * project" flow is the only action.
 */
export const metricsCommand: Command = nativeCommandFactory(metricsConfig);
