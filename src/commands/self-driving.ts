import { runWizard, runWizardCI } from '@lib/runners';
import { selfDrivingConfig } from '@lib/programs/self-driving/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const selfDrivingCommand: Command = {
  name: 'self-driving',
  description: selfDrivingConfig.description,
  options: {
    ...skillProgramOptions,
    ...(selfDrivingConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      selfDrivingConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(selfDrivingConfig, options);
    } else {
      runWizard(selfDrivingConfig, options);
    }
  },
};
