import { featureFlagsConfig } from '@lib/programs/feature-flags/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard feature-flags` — add PostHog feature flags to the project.
 *
 * The agent picks the language/framework variant itself (see the program's
 * `customPrompt`) since context-mill's `feature-flags` skill has no example
 * apps to detect against.
 */
export const featureFlagsCommand: Command =
  nativeCommandFactory(featureFlagsConfig);
