import { CLI_MANIFEST } from '@lib/programs/cli-manifest.generated';
import { migrationConfig } from '@lib/programs/migration/index';

import type { Command } from './command';
import { skillCommandFactory } from './factories/skill-command-factory';

/**
 * The `wizard migrate <vendor>` family.
 *
 * One child per manifest entry under `parentCommand: 'migrate'` (today
 * just `statsig`; future vendors arrive automatically from
 * context-mill). Each child uses `skillCommandFactory`, which overrides
 * `migrationConfig.skillId` with the entry's skill id so the right
 * migration skill runs.
 */
const migrateChildren = CLI_MANIFEST.entries
  .filter(
    (entry) => entry.surface === 'public' && entry.parentCommand === 'migrate',
  )
  .map((entry) => skillCommandFactory(entry, migrationConfig));

export const migrateCommand: Command = {
  name: 'migrate',
  description: migrationConfig.description,
  children: migrateChildren,
};
