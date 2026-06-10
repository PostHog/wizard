import { migrationConfig } from '@lib/programs/migration/index';

import type { Command } from './command';
import { flatSkillCommand } from './factories/flat-skill-command';

/**
 * `wizard migrate` — flat skill command, Statsig today. Stays flat
 * while there's only one vendor. When a second vendor lands, this file
 * restructures into a family (parentCommand: migrate, command per
 * vendor) and the picker opens — a deliberate breaking change at that
 * point, not silent magic introduced now.
 *
 * Resolved from the manifest by skillId; falls back to the built-in
 * config if the snapshot is missing the entry (see flatSkillCommand).
 */
export const migrateCommand: Command = flatSkillCommand(
  'migrate-statsig',
  migrationConfig,
);
