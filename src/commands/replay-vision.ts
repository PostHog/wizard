import { replayVisionConfig } from '@lib/programs/replay-vision/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard replay-vision` — flat skill command, set up Replay vision today.
 *
 * Enables session replay recording and creates vision scanners tailored to
 * the product's key flows. Runs the `replay-vision` orchestrator flow, which
 * reuses the integration-v2 install/init mini-agents when the repo has no
 * PostHog integration yet.
 */
export const replayVisionCommand: Command =
  nativeCommandFactory(replayVisionConfig);
