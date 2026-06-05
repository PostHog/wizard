import { runWizard, runWizardCI } from '@lib/runners';
import { eventsAuditConfig } from '@lib/programs/events-audit/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const eventsAuditCommand: Command = {
  name: 'events-audit',
  description: eventsAuditConfig.description,
  options: {
    ...skillProgramOptions,
    ...(eventsAuditConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      eventsAuditConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(eventsAuditConfig, options);
    } else {
      runWizard(eventsAuditConfig, options);
    }
  },
};
