import { config as transactionalEmailConfig } from '@programs/transactional-email';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

export const transactionalEmailCommand: Command = nativeCommandFactory(
  transactionalEmailConfig,
);
