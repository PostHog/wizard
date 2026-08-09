import { runWizard, runWizardCI, runWizardHeadless } from '@lib/runners';
import { errorTrackingUploadSourceMapsConfig } from '@lib/programs/error-tracking-upload-source-maps/index';
import { runDetectOnly } from '@lib/programs/error-tracking-upload-source-maps/detect-only';
import { headlessOption, isHeadless, regionOption } from '@lib/headless-mode';
import { runCommandHandler } from './factories/shared';
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
    // Project selection for non-interactive runs, passed verbatim from a
    // stored detection report row (the project the user picked in the
    // PostHog app). Hidden like the headless flag: the contract is unstable.
    'selected-path': {
      describe:
        "Project directory to instrument, relative to the repo root ('.' for the root). Non-interactive runs only.",
      type: 'string' as const,
      hidden: true,
    },
    'selected-variant': {
      describe:
        'Source-maps skill variant of the selected project (e.g. nextjs). Non-interactive runs only.',
      type: 'string' as const,
      hidden: true,
    },
    ...headlessOption,
    ...regionOption,
  },
  handler: (argv) => {
    const extras =
      errorTrackingUploadSourceMapsConfig.mapCliOptions?.(
        argv as Record<string, unknown>,
      ) ?? {};
    const options = { ...argv, ...extras };
    if (options.detectOnly) {
      runCommandHandler(() => runDetectOnly(options));
    } else if (isHeadless(options)) {
      runWizardHeadless(errorTrackingUploadSourceMapsConfig, options);
    } else if (options.ci) {
      runWizardCI(errorTrackingUploadSourceMapsConfig, options);
    } else {
      runWizard(errorTrackingUploadSourceMapsConfig, options);
    }
  },
};
