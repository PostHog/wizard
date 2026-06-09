import { CLI_MANIFEST } from '@lib/programs/cli-manifest.generated';
import { migrationConfig } from '@lib/programs/migration/index';

import type { Command } from './command';
import { createFamilyPickerDefault } from './factories/family-picker';
import { skillCommandFactory } from './factories/skill-command-factory';

/**
 * The `wizard migrate <vendor>` family.
 *
 * One child per manifest entry under `parentCommand: 'migrate'` (today
 * just `statsig`; future vendors arrive automatically from
 * context-mill). Each child uses `skillCommandFactory`, which overrides
 * `migrationConfig.skillId` with the entry's skill id so the right
 * migration skill runs.
 *
 * `wizard migrate` with no subcommand runs the single child today; when
 * a vendor is marked default in context-mill, that one runs instead.
 * The picker only kicks in for multi-vendor families without a default.
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
  interactiveDefault: createFamilyPickerDefault(
    'wizard migrate',
    migrateChildren,
  ),
};
