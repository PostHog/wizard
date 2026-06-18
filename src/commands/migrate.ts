import { migrationConfig } from '@lib/programs/migration/index';

import type { Command } from './command';
import { familyCommandFactory } from './factories/family-command-factory';

/**
 * The `wizard migrate` family.
 *
 * Subcommands (statsig, mixpanel, amplitude, sentry, ...) are resolved at
 * runtime: the wizard fetches `cliEntries` from `skill-menu.json` and
 * dispatches based on `parentCommand: 'migrate'`. Each vendor entry's
 * `skillId` (e.g. `migrate-mixpanel`) lands on `session.skillId` so
 * `migrationConfig.run` picks the right skill.
 *
 * Adding a new vendor is a context-mill release — publish the skill with a
 * `cli` block (`role: 'command'`, `parentCommand: 'migrate'`, `command:
 * '<vendor>'`) and it appears under `wizard migrate <vendor>` without a
 * wizard release.
 *
 * `wizard migrate` with no positional opens the family picker.
 */
export const migrateCommand: Command = familyCommandFactory({
  family: 'migrate',
  description: migrationConfig.description,
  optionsFrom: migrationConfig,
});
