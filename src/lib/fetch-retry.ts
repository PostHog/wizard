/**
 * Retry wrapper for fetching from the skills/agents server (GitHub releases in
 * production). GitHub releases blips transiently, so every fetch on the run's
 * critical path — skill menu, skill zips, agent menu, agent prompt bodies —
 * goes through here rather than a bare `fetch`.
 *
 * The retry loop itself lives in `retry.ts`; this owns the HTTP-specific parts
 * (per-attempt timeout, non-ok responses count as failures) and the aggregated
 * "every attempt failed" message.
 */

import {
  retryWithBackoff,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  type RetryPolicy,
} from './retry';

const DEFAULT_TIMEOUT_MS = 60000; // per attempt

export interface RetryOpts extends Pick<RetryPolicy, 'sleepImpl'> {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
}

/** Fetch a URL, retrying transient failures (network error or non-ok HTTP) with backoff. */
export async function fetchWithRetry(
  url: string,
  opts: RetryOpts = {},
): Promise<Response> {
  const {
    fetchImpl = fetch,
    sleepImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs = DEFAULT_BACKOFF_MS,
  } = opts;

  const failures: string[] = [];
  try {
    return await retryWithBackoff(
      async () => {
        const resp = await fetchImpl(url, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        return resp;
      },
      {
        sleepImpl,
        maxAttempts,
        backoffMs,
        onAttemptError: (err, attempt) => {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`attempt ${attempt}: ${message}`);
        },
      },
    );
  } catch {
    throw new Error(`fetch ${url} failed — ${failures.join('; ')}`);
  }
}
