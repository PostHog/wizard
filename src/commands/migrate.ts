import { CLI_MANIFEST } from '@lib/programs/cli-manifest.generated';
import { migrationConfig } from '@lib/programs/migration/index';

import type { Command } from './command';
import { skillCommandFactory } from './factories/skill-command-factory';

/**
 * `wizard migrate` — flat skill command, Statsig today. Stays flat
 * while there's only one vendor. When a second vendor lands, this file
 * restructures into a family (parentCommand: migrate, command per
 * vendor) and the picker opens — a deliberate breaking change at that
 * point, not silent magic introduced now.
 */
const migrateEntry = CLI_MANIFEST.entries.find(
  (entry) =>
    entry.surface === 'public' &&
    !entry.parentCommand &&
    entry.command === 'migrate',
);

if (!migrateEntry) {
  throw new Error(
    'commands/migrate: no public `migrate` entry in CLI_MANIFEST. ' +
      'Check cli-manifest.bootstrap.json or the latest context-mill release.',
  );
}

export const migrateCommand: Command = skillCommandFactory(
  migrateEntry,
  migrationConfig,
);
