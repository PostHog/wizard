import { errorTrackingConfig } from '@store/programs';

import type { Command } from './command.js';
import { nativeCommandFactory } from './factories/native-command-factory.js';

/**
 * `wizard error-tracking` — flat skill command, set up error tracking today.
 *
 * Wires up exception capture and — where the platform needs it — source-map /
 * debug-symbol upload. Runs the `error-tracking` orchestrator flow, which
 * reuses the integration-v2 install/init mini-agents when the repo has no
 * PostHog integration yet, so it works on uninstrumented projects too.
 */
export const errorTrackingCommand: Command =
  nativeCommandFactory(errorTrackingConfig);
