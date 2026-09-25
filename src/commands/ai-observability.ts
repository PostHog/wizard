import { aiObservabilityConfig } from '@lib/programs/ai-observability/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard ai-observability` — flat skill command, wire AI Observability into a
 * project today.
 *
 * Installs the OpenTelemetry SDK, the PostHog span processor, and the
 * provider-specific instrumentation so LLM calls emit `$ai_generation` events.
 * The `ai-observability` context-mill skill has one variant per (LLM provider ×
 * language); the agent picks the right one at run time by scanning the
 * project's manifest and (when ambiguous) asking the user via `wizard_ask`.
 * Stays flat while a single "add AIO to a project" flow is the only action.
 */
export const aiObservabilityCommand: Command = nativeCommandFactory(
  aiObservabilityConfig,
);
