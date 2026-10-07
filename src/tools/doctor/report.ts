import type { ConsoleLog } from '@shared/console-log';
import { ErrorCodes, emitWizardError } from '@shared/errors';
import { fetchHealthIssues } from './fetch';
import { getKindMeta } from './kind-metadata';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** Resolves 0 when the project is healthy, and 1 on issues, a missing key or a failed fetch. */
export async function runDoctorReport(
  {
    apiKey,
    projectId,
    baseUrl,
  }: { apiKey?: string; projectId?: number; baseUrl?: string },
  { log }: { log: ConsoleLog },
): Promise<number> {
  if (!apiKey) {
    log.intro('PostHog Wizard');
    log.log.error('CI mode requires --api-key (personal API key phx_xxx)');
    emitWizardError({
      code: ErrorCodes.ArgsMissingApiKey,
      message: 'CI mode requires --api-key (personal API key phx_xxx)',
    });
    return 1;
  }

  log.intro('Welcome to the PostHog setup wizard');
  log.log.info('Running posthog-doctor in CI mode');

  try {
    const { resolveApiKeyProject } = await import('@shared/api-key-login');
    const { host, projectId: resolvedProjectId } = await resolveApiKeyProject(
      apiKey,
      {
        projectId,
        baseUrl,
        onInfo: (message) => log.log.info(message),
        onWarning: (message) => log.log.warn(message),
      },
    );

    const issues = await fetchHealthIssues(
      apiKey,
      host.apiHost,
      resolvedProjectId,
    );
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
    const { ApiError } = await import('@shared/api');
    const message =
      error instanceof ApiError && error.statusCode === 401
        ? 'Your PostHog API key is invalid or expired.'
        : error instanceof Error
        ? error.message
        : String(error);
    log.log.error(`Doctor failed: ${message}`);
    emitWizardError({
      code:
        error instanceof ApiError && error.statusCode === 401
          ? ErrorCodes.AuthInvalidOrExpired
          : ErrorCodes.InternalUnhandled,
      message,
    });
    return 1;
  }
}
