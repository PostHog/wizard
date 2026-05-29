import { runWizard, runWizardCI } from '@lib/runners';
import { posthogDoctorConfig } from '@lib/programs/posthog-doctor/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const doctorCommand: Command = {
  name: 'doctor',
  description: posthogDoctorConfig.description,
  options: {
    ...skillProgramOptions,
    ...(posthogDoctorConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      posthogDoctorConfig.mapCliOptions?.(argv as Record<string, unknown>) ??
      {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(posthogDoctorConfig, options);
    } else {
      runWizard(posthogDoctorConfig, options);
    }
  },
};
