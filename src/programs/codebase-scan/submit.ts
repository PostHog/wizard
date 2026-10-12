/**
 * Sends a codebase scan to `POST /api/projects/{project_id}/wizard/scans/`.
 *
 * Fail-silent, like the session push: never throws, never writes to the
 * terminal, never blocks the run. Outcomes go to the debug log. The endpoint is
 * idempotent per `session_id`, so a retry after a lost response is safe.
 *
 * Retry policy (same as `PostHogDestination`):
 *   5xx / network → exponential backoff base 500ms cap 8s, max 3 attempts
 *   429           → honour `Retry-After` (seconds), single retry
 *   anything else → give up; a 404 is an instance without the endpoint
 */

import type { Credentials } from '@shared/api';
import { logToFile } from '@utils/debug';
import { parseRetryAfter } from '../session/task-stream/destinations/posthog';

/** Wire shape of a scan; see the PostHog `wizard/scans` serializer. */
export type CodebaseScanPayload = {
  session_id: string;
  program: string;
  wizard_version: string;
  workspace_fingerprint: string;
  scanned_at: string;
  tools: {
    kind: string;
    signals: { source: string; name: string; file: string | null }[];
  }[];
};

export type SubmitOptions = {
  /** Override for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitCodebaseScan(
  credentials: Pick<Credentials, 'accessToken' | 'projectId' | 'host'>,
  payload: CodebaseScanPayload,
  options: SubmitOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  const sleep = options.sleep ?? defaultSleep;
  const url = `${credentials.host.apiHost.replace(/\/$/, '')}/api/projects/${
    credentials.projectId
  }/wizard/scans/`;
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.accessToken}`,
    },
    body: JSON.stringify(payload),
  };

  let attempt = 0;
  let backoff = BASE_BACKOFF_MS;
  let retriedAfter429 = false;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) {
        logToFile(`[codebase-scan] submit failed: ${String(error)}`);
        return;
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      continue;
    }

    if (response.ok) {
      logToFile(`[codebase-scan] submit ok: ${response.status}`);
      return;
    }

    const status = response.status;
    if (status === 429 && !retriedAfter429) {
      retriedAfter429 = true;
      await sleep(parseRetryAfter(response.headers.get('Retry-After')));
      // Don't count this against the 5xx attempt budget.
      attempt -= 1;
      continue;
    }
    if (status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      continue;
    }
    logToFile(`[codebase-scan] submit gave up: ${status}`);
    return;
  }
}
