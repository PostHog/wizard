import { runWizard, runWizardCI } from '../runners/index.js';
import { errorTrackingUploadSourceMapsConfig } from '@store/programs';
import { skillProgramOptions } from './skill-program-options.js';
import type { Command } from './command.js';

export const uploadSourcemapsCommand: Command = {
  // Must match ProgramConfig.command; legacy alias kept for #489 regression.
  name: [errorTrackingUploadSourceMapsConfig.command!, 'upload-sourcemaps'],
  description: errorTrackingUploadSourceMapsConfig.description,
  options: {
    ...skillProgramOptions,
    ...(errorTrackingUploadSourceMapsConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      errorTrackingUploadSourceMapsConfig.mapCliOptions?.(
        argv as Record<string, unknown>,
      ) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(errorTrackingUploadSourceMapsConfig, options);
    } else {
      runWizard(errorTrackingUploadSourceMapsConfig, options);
    }
  },
};
