export {
  runMigrationWizard,
  checkAndOfferMigration,
  detectProviderInstallation,
  getAllInstalledProviderPackages,
} from './migration-wizard';

export type {
  MigrationProviderConfig,
  InstalledPackage,
  MigrationOptions,
  MigrationDocsOptions,
  MigrationContext,
  MigrationOutroOptions,
} from './types';

export {
  getMigrationProvider,
  getAvailableMigrationProviders,
  migrationProviders,
  amplitudeProvider,
} from './providers';

export { AMPLITUDE_PACKAGES } from './providers/amplitude';

import { runMigrationWizard, checkAndOfferMigration } from './migration-wizard';
import type { MigrationOptions } from './types';
import type { WizardOptions } from '../utils/types';

export async function runAmplitudeMigrationWizard(
  options: MigrationOptions,
): Promise<void> {
  return runMigrationWizard(options, 'amplitude');
}

export async function checkAndOfferAmplitudeMigration(
  options: WizardOptions,
): Promise<boolean> {
  return checkAndOfferMigration(options, 'amplitude');
}
