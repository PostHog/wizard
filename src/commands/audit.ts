import { runWizard, runWizardCI } from '@lib/runners';
import { auditConfig } from '@lib/programs/audit/index';
import { webAnalyticsDoctorConfig } from '@lib/programs/web-analytics-doctor/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

const dispatchProgram = (
  config: typeof auditConfig | typeof webAnalyticsDoctorConfig,
  argv: Record<string, unknown>,
): void => {
  const extras = config.mapCliOptions?.(argv) ?? {};
  const options = { ...argv, ...extras };
  if (options.ci) {
    runWizardCI(config, options);
  } else {
    runWizard(config, options);
  }
};

const webAnalyticsCommand: Command = {
  name: webAnalyticsDoctorConfig.command!,
  description: webAnalyticsDoctorConfig.description,
  options: {
    ...skillProgramOptions,
    ...(webAnalyticsDoctorConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    dispatchProgram(webAnalyticsDoctorConfig, argv as Record<string, unknown>);
  },
};

export const auditCommand: Command = {
  name: 'audit',
  description: auditConfig.description,
  children: [webAnalyticsCommand],
  options: {
    ...skillProgramOptions,
    ...(auditConfig.cliOptions ?? {}),
  },
  handler: (argv) => {
    dispatchProgram(auditConfig, argv as Record<string, unknown>);
  },
};
