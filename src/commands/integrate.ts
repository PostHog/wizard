import { runWizard, runWizardCI } from '@lib/runners';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const integrateCommand: Command = {
  name: 'integrate',
  description: posthogIntegrationConfig.description,
  options: {
    ...skillProgramOptions,
    ...(posthogIntegrationConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      posthogIntegrationConfig.mapCliOptions?.(
        argv as Record<string, unknown>,
      ) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(posthogIntegrationConfig, options);
    } else {
      runWizard(posthogIntegrationConfig, options);
    }
  },
};
