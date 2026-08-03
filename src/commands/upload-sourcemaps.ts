import { runWizard, runWizardCI } from '@lib/runners';
import { errorTrackingUploadSourceMapsConfig } from '@lib/programs/error-tracking-upload-source-maps/index';
import { runDetectOnly } from '@lib/programs/error-tracking-upload-source-maps/detect-only';
import { regionOption } from '@lib/headless-mode';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const uploadSourcemapsCommand: Command = {
  // Must match ProgramConfig.command; legacy alias kept for #489 regression.
  name: [errorTrackingUploadSourceMapsConfig.command!, 'upload-sourcemaps'],
  description: errorTrackingUploadSourceMapsConfig.description,
  options: {
    ...skillProgramOptions,
    ...(errorTrackingUploadSourceMapsConfig.cliOptions ?? {}),
    // Non-interactive detection-only mode: scan the repo, POST the report to
    // PostHog, exit. Used by the cloud wizard run; hidden like the headless
    // flag because the contract is unstable.
    'detect-only': {
      default: false,
      describe:
        'Run the source-map detection only and save the result to PostHog',
      type: 'boolean' as const,
      hidden: true,
    },
    repository: {
      describe:
        'Repository the detection is for (org/repo). Defaults to the git origin remote.',
      type: 'string' as const,
      hidden: true,
    },
    ...regionOption,
  },
  handler: (argv) => {
    const extras =
      errorTrackingUploadSourceMapsConfig.mapCliOptions?.(
        argv as Record<string, unknown>,
      ) ?? {};
    const options = { ...argv, ...extras };
    if (options.detectOnly) {
      void runDetectOnly(options);
    } else if (options.ci) {
      runWizardCI(errorTrackingUploadSourceMapsConfig, options);
    } else {
      runWizard(errorTrackingUploadSourceMapsConfig, options);
    }
  },
};
