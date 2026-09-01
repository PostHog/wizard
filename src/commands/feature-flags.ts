import { featureFlagsConfig } from '@lib/programs/feature-flags/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard feature-flags` — flat skill command.
 *
 * Distinct from `wizard audit feature-flags` (read-only cost/correctness
 * audit) and from `wizard migrate` (come from another vendor). Stays flat
 * while install-and-instrument is the only action.
 */
export const featureFlagsCommand: Command =
  nativeCommandFactory(featureFlagsConfig);
