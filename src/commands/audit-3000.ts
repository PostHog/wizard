import { runWizard, runWizardCI } from '@lib/runners';
import { audit3000Config } from '@lib/programs/audit-3000/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const audit3000Command: Command = {
  name: 'audit-3000',
  description: audit3000Config.description,
  options: {
    ...skillProgramOptions,
    ...(audit3000Config.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      audit3000Config.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(audit3000Config, options);
    } else {
      runWizard(audit3000Config, options);
    }
  },
};
