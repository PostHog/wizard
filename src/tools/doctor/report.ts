/** `wizard doctor --ci`: log in with a personal API key and print the project's active health issues. */

import { ApiError } from '@shared/api';
import { resolveApiKeyProject } from '@shared/api-key-login';
import type { ConsoleLog } from '@shared/console-log';
import { ErrorCodes, emitWizardError } from '@shared/errors';
import { flushAnalytics } from '@utils/flush-analytics';
import { fetchHealthIssues } from './fetch';
import { getKindMeta } from './kind-metadata';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;
const MISSING_KEY = 'CI mode requires --api-key (personal API key phx_xxx)';

/** Resolves 0 when the project is healthy, and 1 on issues, a missing key or a failed fetch. */
export async function runDoctorReport(
  args: { apiKey?: string; projectId?: number; baseUrl?: string },
  { log }: { log: ConsoleLog },
): Promise<number> {
  const code = await report(args, log);
  await flushAnalytics();
  return code;
}

async function report(
  { apiKey, projectId, baseUrl }: Parameters<typeof runDoctorReport>[0],
  log: ConsoleLog,
): Promise<number> {
  if (!apiKey) {
    log.intro('PostHog Wizard');
    log.log.error(MISSING_KEY);
    emitWizardError({
      code: ErrorCodes.ArgsMissingApiKey,
      message: MISSING_KEY,
    });
    return 1;
  }

  log.intro('Welcome to the PostHog setup wizard');
  log.log.info('Running posthog-doctor in CI mode');

  try {
    log.log.info('Using provided API key (CI mode - OAuth bypassed)');
    const { host, project } = await resolveApiKeyProject(apiKey, {
      projectId,
      baseUrl,
      onWarning: (message) => log.log.warn(message),
    });

    const issues = await fetchHealthIssues(apiKey, host.apiHost, project.id);
    if (issues.length === 0) {
      log.log.success('No active issues — your project looks healthy.');
      return 0;
    }

    const sorted = [...issues].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    log.log.warn(
      `${issues.length} active issue${issues.length === 1 ? '' : 's'} found:`,
    );
    for (const issue of sorted) {
      log.log.info(`  • [${issue.severity}] ${getKindMeta(issue.kind).title}`);
    }
    return 1;
  } catch (error) {
    const unauthorized = error instanceof ApiError && error.statusCode === 401;
    const message = unauthorized
      ? 'Your PostHog API key is invalid or expired.'
      : error instanceof Error
      ? error.message
      : String(error);
    log.log.error(`Doctor failed: ${message}`);
    emitWizardError({
      code: unauthorized
        ? ErrorCodes.AuthInvalidOrExpired
        : ErrorCodes.InternalUnhandled,
      message,
    });
    return 1;
  }
}
