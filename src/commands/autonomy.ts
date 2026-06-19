import { runWizard, runWizardCI } from '@lib/runners';
import { productAutonomyConfig } from '@lib/programs/product-autonomy/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const autonomyCommand: Command = {
  name: 'self-driving',
  description: productAutonomyConfig.description,
  options: {
    ...skillProgramOptions,
    ...(productAutonomyConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      productAutonomyConfig.mapCliOptions?.(argv as Record<string, unknown>) ??
      {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(productAutonomyConfig, options);
    } else {
      runWizard(productAutonomyConfig, options);
    }
  },
};
