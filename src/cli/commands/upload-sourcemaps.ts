import { runWizard, runWizardCI } from '@cli/runners';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';
import { errorTrackingUploadSourceMapsConfig } from '@programs';

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
