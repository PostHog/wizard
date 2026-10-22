import { config as transactionalEmailConfig } from '@programs/transactional-email';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/** `wizard transactional-email`: send the first transactional email from the project's server code. */
export const transactionalEmailCommand: Command = nativeCommandFactory(
  transactionalEmailConfig,
);
