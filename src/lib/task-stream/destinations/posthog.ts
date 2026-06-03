/**
 * PostHog destination — pushes wizard run state to the PostHog backend
 * via `POST /api/projects/{project_id}/wizard/sessions/`.
 *
 * The endpoint is an upsert keyed by `(team, session_id)`: 201 means
 * the row was created, 200 means it was updated. Both are success.
 *
 * Failure handling is fail-silent: never throws to the caller, never
 * writes to stdout/stderr, never blocks the agent. Errors flow through
 * the optional `onError` callback for the wizard's debug log.
 *
 * Retry policy:
 *   5xx / network    → exponential backoff base 500ms cap 8s, max 3 attempts
 *   429              → honour `Retry-After` (seconds), single retry
 *   401 / 403        → disable for the rest of the run, no further pushes
 *   400              → give up for this push, do not disable
 *   other 4xx        → give up for this push, do not disable
 */

import type {
  TaskStreamDestination,
  TaskStreamUpdate,
  StreamEvent,
} from '@lib/task-stream/types';
import type { Credentials } from '@lib/wizard-session';

export interface PostHogDestinationOptions {
  /**
   * Lazy credential resolver — called on every send. Returns null
   * before authentication has completed; in that case the send is a
   * no-op (no HTTP request).
   */
  getCredentials: () => Credentials | null;
  /** Receives every error for the wizard's internal logfile. */
  onError?: (err: Error) => void;
  /** Override for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
const DEFAULT_RETRY_AFTER_MS = 1000;
// setTimeout silently clamps anything above 2^31-1 ms to fire
// immediately, so any Retry-After-derived sleep must be capped.
const MAX_RETRY_AFTER_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number {
  if (!value) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  // HTTP-date form — best-effort.
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
  }
  return DEFAULT_RETRY_AFTER_MS;
}

/**
 * Strip the internal-only `timestamp` field before sending. The
 * backend schema in the RFC does not define it.
 */
function toWirePayload(
  payload: TaskStreamUpdate,
): Omit<TaskStreamUpdate, 'timestamp'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { timestamp: _unused, ...rest } = payload;
  return rest;
}

export class PostHogDestination implements TaskStreamDestination {
  readonly name = 'posthog';

  private readonly getCredentials: () => Credentials | null;
  private readonly onError: (err: Error) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  private disabled = false;

  constructor(opts: PostHogDestinationOptions) {
    this.getCredentials = opts.getCredentials;
    this.onError = opts.onError ?? (() => undefined);
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async send(_event: StreamEvent, payload: TaskStreamUpdate): Promise<void> {
    if (this.disabled) return;
    const creds = this.getCredentials();
    if (!creds) return;

    await this.postWithRetry(creds, toWirePayload(payload));
  }

  private buildRequest(
    creds: Credentials,
    body: object,
  ): { url: string; init: Parameters<typeof fetch>[1] } {
    const url = `${creds.host.replace(/\/$/, '')}/api/projects/${
      creds.projectId
    }/wizard/sessions/`;
    return {
      url,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.accessToken}`,
        },
        body: JSON.stringify(body),
      },
    };
  }

  private async postWithRetry(creds: Credentials, body: object): Promise<void> {
    const { url, init } = this.buildRequest(creds, body);
    let attempt = 0;
    let backoff = BASE_BACKOFF_MS;
    let retriedAfter429 = false;

    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;
      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS) {
          this.onError(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }

      if (response.ok) return;

      const status = response.status;

      if (status === 401 || status === 403) {
        this.disabled = true;
        this.onError(new Error(`wizard/sessions auth failed: ${status}`));
        return;
      }

      if (status === 429) {
        if (retriedAfter429) {
          this.onError(new Error('wizard/sessions rate limited'));
          return;
        }
        retriedAfter429 = true;
        const wait = parseRetryAfter(response.headers.get('Retry-After'));
        await this.sleep(wait);
        // Don't count this against the 5xx attempt budget.
        attempt -= 1;
        continue;
      }

      if (status >= 500) {
        if (attempt >= MAX_ATTEMPTS) {
          this.onError(new Error(`wizard/sessions server error: ${status}`));
          return;
        }
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }

      if (status === 400) {
        let detail = '';
        try {
          detail = await response.text();
        } catch {
          // ignore
        }
        this.onError(new Error(`wizard/sessions bad request (400): ${detail}`));
        return;
      }

      this.onError(new Error(`wizard/sessions unexpected status: ${status}`));
      return;
    }
  }
}
