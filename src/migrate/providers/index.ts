import type { MigrationProviderConfig } from '../types';
import { amplitudeProvider } from './amplitude';

export const migrationProviders: Record<string, MigrationProviderConfig> = {
  amplitude: amplitudeProvider,
};

export function getMigrationProvider(
  id: string,
): MigrationProviderConfig | undefined {
  return migrationProviders[id];
}

export function getAvailableMigrationProviders(): string[] {
  return Object.keys(migrationProviders);
}

export { amplitudeProvider } from './amplitude';
