import { cullFeatureFlagsConfig } from '@lib/programs/cull-feature-flags/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

export const cullFeatureFlagsCommand: Command = nativeCommandFactory(
  cullFeatureFlagsConfig,
);
