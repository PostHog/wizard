import { migrationConfig } from '@lib/programs/migration/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';

/**
 * `wizard migrate` — flat skill command, Statsig today.
 *
 * Stays flat while there's only one vendor. When a second vendor lands,
 * restructure into a family with `familyCommandFactory` and publish each
 * vendor as a `cliEntries` entry with `parentCommand: 'migrate'` from
 * context-mill. That move is a deliberate breaking change for users
 * (`wizard migrate` stops running Statsig directly), so do it explicitly
 * when the second vendor arrives, not pre-emptively.
 */
export const migrateCommand: Command = nativeCommandFactory(migrationConfig);
