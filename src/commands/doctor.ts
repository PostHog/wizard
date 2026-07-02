import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { readApiKeyFromEnv } from '@utils/env-api-key';
import { runWizard } from '@lib/runners';
import {
  posthogDoctorConfig,
  fetchHealthIssues,
  getKindMeta,
} from '@lib/programs/posthog-doctor/index';
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
    // doctor is otherwise a TUI-only diagnostic (it has no agent run); in CI we
    // fetch the project's health issues headlessly and report them instead.
    if (options.ci) {
      void runDoctorCI(options);
    } else {
      runWizard(posthogDoctorConfig, options);
    }
  },
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

async function runDoctorCI(options: Record<string, unknown>): Promise<void> {
  setUI(new LoggingUI());
  const apiKey = (options.apiKey as string) ?? readApiKeyFromEnv() ?? undefined;
  if (!apiKey) {
    getUI().intro('PostHog Wizard');
    getUI().log.error('CI mode requires --api-key (personal API key phx_xxx)');
    process.exit(1);
  }

  getUI().intro('Welcome to the PostHog setup wizard');
  getUI().log.info('Running posthog-doctor in CI mode');

  try {
    const { getOrAskForProjectData } = await import('@utils/setup-utils');
    const { host, accessToken, projectId } = await getOrAskForProjectData({
      signup: false,
      ci: true,
      apiKey,
      projectId: options.projectId
        ? Number(options.projectId as string)
        : undefined,
      baseUrl: options.baseUrl as string | undefined,
    });

    const issues = await fetchHealthIssues(accessToken, host, projectId);
    if (issues.length === 0) {
      getUI().log.success('No active issues — your project looks healthy.');
      process.exit(0);
    }

    const sorted = [...issues].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    getUI().log.warn(
      `${issues.length} active issue${issues.length === 1 ? '' : 's'} found:`,
    );
    for (const issue of sorted) {
      getUI().log.info(
        `  • [${issue.severity}] ${getKindMeta(issue.kind).title}`,
      );
    }
    process.exit(1);
  } catch (error) {
    const { ApiError } = await import('@lib/api');
    const message =
      error instanceof ApiError && error.statusCode === 401
        ? 'Your PostHog API key is invalid or expired.'
        : error instanceof Error
        ? error.message
        : String(error);
    getUI().log.error(`Doctor failed: ${message}`);
    process.exit(1);
  }
}
