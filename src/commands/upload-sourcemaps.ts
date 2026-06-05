import { runWizard, runWizardCI } from '@lib/runners';
import { errorTrackingUploadSourceMapsConfig } from '@lib/programs/error-tracking-upload-source-maps/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const uploadSourcemapsCommand: Command = {
  name: 'upload-sourcemaps',
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
