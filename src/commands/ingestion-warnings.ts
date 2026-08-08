import { ingestionWarningsConfig } from '@lib/programs/ingestion-warnings/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard ingestion-warnings` — flat skill command.
 *
 * Diagnoses the ingestion warnings firing on the user's PostHog project and
 * fixes the instrumentation producing them. Stays flat: there's a single
 * thing to do here, not a family of choices.
 */
export const ingestionWarningsCommand: Command = nativeCommandFactory(
  ingestionWarningsConfig,
);
