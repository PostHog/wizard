import { shakespeareConfig } from '@lib/programs/shakespeare/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard shakespeare` — internal test-only command. See
 * `src/lib/programs/shakespeare/index.ts` for why this exists.
 */
export const shakespeareCommand: Command =
  nativeCommandFactory(shakespeareConfig);
