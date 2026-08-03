/**
 * Headless detection-only mode for `upload-source-maps --detect-only`.
 *
 * Runs the agentic source-maps detection and POSTs the result to
 * `/api/projects/{id}/wizard/repository_detections/` instead of driving the
 * interactive program. Built for the cloud wizard run (the tasks sandbox
 * scans a connected repository in the background and the app presents the
 * result later); also runs locally with `--api-key`. Never enters the TUI or
 * the agent runner — mirrors `runDoctorCI`'s "auth, do API work, exit" shape.
 */

import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { TASK_RUN_ID } from '@env';
import { analytics } from '@utils/analytics';
import { logToFile, configureLogFileFromEnvironment } from '@utils/debug';
import { parseGitRemote } from '@utils/setup-utils';
import { buildSession } from '@lib/wizard-session';
import type { Credentials, CloudRegion } from '@lib/wizard-session';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { validateNonInteractiveOptions } from '@lib/runners/run-non-interactive';
import { resolveNoTelemetry } from '@lib/runners/resolve-no-telemetry';
import { Program } from '@lib/programs/program-registry';
import {
  detectSourceMapsProjects,
  type DetectionReport,
} from './detect-agentic.js';

/** The `kind` discriminator this program writes repository detections under. */
export const DETECTION_KIND = 'error-tracking-source-maps';

/**
 * Background budget for the scan. Deliberately looser than the interactive
 * AGENTIC_DETECTION_TIMEOUT_MS (60s) — nobody is watching a spinner here, and
 * large monorepos are exactly the repos worth waiting on.
 */
export const DETECT_ONLY_TIMEOUT_MS = 5 * 60 * 1000;

/** Sentinel for a scan that outran DETECT_ONLY_TIMEOUT_MS. */
const TIMED_OUT = Symbol('timed-out');

/** The upsert body for POST /api/projects/{id}/wizard/repository_detections/. */
export type DetectionUpsertPayload = {
  repository: string;
  kind: string;
  report?: {
    repo_type: 'monorepo' | 'single';
    projects: {
      path: string;
      framework: string;
      variant: string | null;
      has_posthog: boolean;
      instrumentable: boolean;
      reason?: string;
    }[];
  };
  error?: { type: string; message: string };
  task_run_id?: string;
};

/** Map the camelCase in-process report onto the snake_case API contract. */
export function toDetectionPayload(
  repository: string,
  report: DetectionReport,
): DetectionUpsertPayload {
  return {
    repository,
    kind: DETECTION_KIND,
    report: {
      repo_type: report.repoType,
      projects: report.projects.map((p) => ({
        path: p.path,
        framework: p.framework,
        variant: p.variant,
        has_posthog: p.hasPostHog,
        instrumentable: p.instrumentable,
        ...(p.reason ? { reason: p.reason } : {}),
      })),
    },
    ...(TASK_RUN_ID ? { task_run_id: TASK_RUN_ID } : {}),
  };
}

function toErrorPayload(
  repository: string,
  type: string,
  message: string,
): DetectionUpsertPayload {
  // The API caps error.message at 2000 chars; truncate rather than 400.
  return {
    repository,
    kind: DETECTION_KIND,
    error: { type, message: message.slice(0, 2000) },
    ...(TASK_RUN_ID ? { task_run_id: TASK_RUN_ID } : {}),
  };
}

/**
 * The repository the detection is for, in `org/repo` form. The cloud run
 * passes it explicitly (`--repository`, from the task); local runs fall back
 * to parsing the git remote of the install dir.
 */
export function resolveRepository(
  explicit: string | undefined,
  installDir: string,
): string | null {
  if (explicit && /^[\w.-]+\/[\w.-]+$/.test(explicit)) return explicit;
  if (explicit) return null;
  const remote = parseGitRemote(installDir);
  return remote ? `${remote.org}/${remote.repo}` : null;
}

async function postDetection(
  creds: Credentials,
  payload: DetectionUpsertPayload,
): Promise<void> {
  const url = `${creds.host.apiHost.replace(/\/$/, '')}/api/projects/${
    creds.projectId
  }/wizard/repository_detections/`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Posting the detection failed (HTTP ${response.status}): ${body.slice(
        0,
        500,
      )}`,
    );
  }
}

/**
 * Entry point for `upload-source-maps --detect-only`. Owns its exits: 0 when
 * a result (success or recorded failure) reached PostHog, 1 otherwise.
 */
export async function runDetectOnly(
  options: Record<string, unknown>,
): Promise<void> {
  setUI(new LoggingUI());
  validateNonInteractiveOptions(options, 'headless');
  analytics.setTag('build', 'headless');
  configureLogFileFromEnvironment();

  const path = await import('path');
  const { readEnvironment } = await import('@utils/environment');
  const env = readEnvironment();
  const installDir = path.isAbsolute(options.installDir as string)
    ? (options.installDir as string)
    : path.join(process.cwd(), options.installDir as string);

  const session = buildSession({
    debug: options.debug as boolean | undefined,
    installDir,
    ci: true,
    apiKey: options.apiKey as string | undefined,
    projectId: options.projectId as string | undefined,
    baseUrl: options.baseUrl as string | undefined,
    localMcp: options.localMcp as boolean | undefined,
    noTelemetry: resolveNoTelemetry(options),
    ...env,
    // After the spread: yargs already resolves flag-over-env for --region,
    // so the parsed value must win over the raw env bag.
    region: (options.region ?? env.region) as CloudRegion | undefined,
  });
  session.programLabel = Program.ErrorTrackingUploadSourceMaps;

  getUI().intro('PostHog Wizard');
  getUI().log.info('Running source-map detection (detect-only mode)');

  const repository = resolveRepository(
    options.repository as string | undefined,
    installDir,
  );
  if (!repository) {
    getUI().log.error(
      'Could not resolve the repository. Pass --repository org/repo, or run inside a git checkout with an origin remote.',
    );
    process.exit(1);
  }

  try {
    await authenticate(session, Program.ErrorTrackingUploadSourceMaps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getUI().log.error(`Authentication failed: ${message}`);
    process.exit(1);
  }
  // authenticate() either sets credentials or throws.
  const creds = session.credentials!;

  const startedAt = Date.now();
  let report: DetectionReport | typeof TIMED_OUT;
  try {
    report = await Promise.race([
      detectSourceMapsProjects(session, (line) =>
        logToFile('[detect-only]', line),
      ),
      // The agent has no abort plumbing, so a timed-out scan is abandoned in
      // the background rather than cancelled; the run stops waiting either way.
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), DETECT_ONLY_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    analytics.captureException(err, { step: 'detect_only' });
    await recordFailure(creds, repository, 'agent-error', err.message);
    process.exit(1);
  }

  if (report === TIMED_OUT) {
    await recordFailure(
      creds,
      repository,
      'timeout',
      `Detection did not finish within ${DETECT_ONLY_TIMEOUT_MS / 1000}s`,
    );
    process.exit(1);
  }

  const instrumentable = report.projects.filter((p) => p.instrumentable).length;
  const payload = toDetectionPayload(repository, report);
  // Surface the scan result BEFORE the POST so a failed upload doesn't lose it.
  getUI().log.info(
    `Detected ${report.projects.length} project${
      report.projects.length === 1 ? '' : 's'
    } (${instrumentable} ready): ${report.projects
      .map((p) => `${p.path}${p.variant ? ` (${p.variant})` : ''}`)
      .join(', ')}`,
  );
  logToFile('[detect-only] payload:', JSON.stringify(payload));

  try {
    await postDetection(creds, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getUI().log.error(message);
    process.exit(1);
  }

  analytics.wizardCapture('sourcemaps detect-only completed', {
    duration_ms: Date.now() - startedAt,
    repo_type: report.repoType,
    project_count: report.projects.length,
    instrumentable_count: instrumentable,
  });
  getUI().log.success(
    `Detection saved: ${report.projects.length} project${
      report.projects.length === 1 ? '' : 's'
    } found, ${instrumentable} ready for source-map upload.`,
  );
  await analytics.shutdown('success');
  process.exit(0);
}

/** Best-effort: record the failure server-side so the app can show it. */
async function recordFailure(
  creds: Credentials,
  repository: string,
  type: string,
  message: string,
): Promise<void> {
  getUI().log.error(`Detection failed (${type}): ${message}`);
  analytics.wizardCapture('sourcemaps detect-only failed', {
    error_type: type,
  });
  try {
    await postDetection(creds, toErrorPayload(repository, type, message));
  } catch (error) {
    logToFile(
      '[detect-only] failed to record the failure:',
      error instanceof Error ? error.message : String(error),
    );
  }
  await analytics.shutdown('error');
}
