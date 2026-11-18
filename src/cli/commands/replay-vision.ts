import { config as replayVisionConfig } from '@programs/replay-vision';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard replay-vision` — flat skill command, set up Replay vision today.
 *
 * Enables session replay recording and creates vision scanners tailored to
 * the product's key flows. Runs the `replay-vision` orchestrator flow, which
 * installs and initializes the SDK first when the repo has no PostHog
 * integration yet.
 */
export const replayVisionCommand: Command =
  nativeCommandFactory(replayVisionConfig);
