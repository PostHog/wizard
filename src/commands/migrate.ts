import { runWizard, runWizardCI } from '@lib/runners';
import { migrationConfig } from '@lib/programs/migration/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const migrateCommand: Command = {
  name: 'migrate',
  description: migrationConfig.description,
  options: {
    ...skillProgramOptions,
    ...(migrationConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      migrationConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(migrationConfig, options);
    } else {
      runWizard(migrationConfig, options);
    }
  },
};
