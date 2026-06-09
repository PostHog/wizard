import { migrationConfig } from '@lib/programs/migration/index';

import { nativeCommandFactory } from './factories/native-command-factory';

export const migrateCommand = nativeCommandFactory(migrationConfig);
