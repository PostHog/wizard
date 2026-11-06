import { config as sideCarConfig } from '@programs/side-car';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/** `wizard side-car`: forward an existing analytics vendor's calls to PostHog. */
export const sideCarCommand: Command = nativeCommandFactory(sideCarConfig);
