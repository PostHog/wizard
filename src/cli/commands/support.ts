import { config as supportConfig } from '@programs/support';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard support` — flat command: enable PostHog Support and wire its in-app
 * widget into a web app. Runs the `support` orchestrator flow.
 */
export const supportCommand: Command = nativeCommandFactory(supportConfig);
