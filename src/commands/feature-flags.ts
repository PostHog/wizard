import { featureFlagsConfig } from '@lib/programs/feature-flags/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

export const featureFlagsCommand: Command =
  nativeCommandFactory(featureFlagsConfig);
