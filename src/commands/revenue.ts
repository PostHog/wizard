import { runWizard, runWizardCI } from '@lib/runners';
import { revenueAnalyticsConfig } from '@lib/programs/revenue-analytics/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const revenueCommand: Command = {
  name: 'revenue',
  description: revenueAnalyticsConfig.description,
  options: {
    ...skillProgramOptions,
    ...(revenueAnalyticsConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    const extras =
      revenueAnalyticsConfig.mapCliOptions?.(argv as Record<string, unknown>) ??
      {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(revenueAnalyticsConfig, options);
    } else {
      runWizard(revenueAnalyticsConfig, options);
    }
  },
};
