import { config as featureFlagsConfig } from '@programs/feature-flags';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

export const featureFlagsCommand: Command =
  nativeCommandFactory(featureFlagsConfig);
