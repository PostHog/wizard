import { replayVisionConfig } from '@lib/programs/replay-vision/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard replay-vision` — flat skill command, scanner setup today.
 *
 * Enables session replay if needed, then creates Replay Vision scanners
 * scoped from the repo. Stays flat while setup is the only action.
 */
export const replayVisionCommand: Command =
  nativeCommandFactory(replayVisionConfig);
