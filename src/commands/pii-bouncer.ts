import { runWizard, runWizardCI } from '@lib/runners';
import { piiBouncerConfig } from '@lib/programs/pii-bouncer/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const piiBouncerCommand: Command = {
  name: 'pii-bouncer',
  description: piiBouncerConfig.description,
  options: {
    ...skillProgramOptions,
    ...(piiBouncerConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      piiBouncerConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(piiBouncerConfig, options);
    } else {
      runWizard(piiBouncerConfig, options);
    }
  },
};
