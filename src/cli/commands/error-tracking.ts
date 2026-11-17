import { config as errorTrackingConfig } from '@programs/error-tracking';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard error-tracking` — flat skill command, set up error tracking today.
 *
 * Wires up exception capture and — where the platform needs it — source-map /
 * debug-symbol upload. Runs the `error-tracking` orchestrator flow, which
 * installs and initializes the SDK first when the repo has no PostHog
 * integration yet, so it works on uninstrumented projects too.
 */
export const errorTrackingCommand: Command =
  nativeCommandFactory(errorTrackingConfig);
