import { runWizard, runWizardCI } from '@lib/runners';
import { auditConfig } from '@lib/programs/audit/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const auditCommand: Command = {
  name: 'audit',
  description: auditConfig.description,
  options: {
    ...skillProgramOptions,
    ...(auditConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      auditConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(auditConfig, options);
    } else {
      runWizard(auditConfig, options);
    }
  },
};
