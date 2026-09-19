import { dispatchProgram } from './factories/shared.js';
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
  handler: (argv) => dispatchProgram(errorTrackingUploadSourceMapsConfig, argv),
};
