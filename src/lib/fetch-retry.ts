/**
 * Retry wrapper for fetching from the skills/agents server (GitHub releases in
 * production). GitHub releases blips transiently, so every fetch on the run's
 * critical path — skill menu, skill zips, agent menu, agent prompt bodies —
 * goes through here rather than a bare `fetch`.
 */

const DEFAULT_TIMEOUT_MS = 60000; // per attempt
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 500; // doubles each retry

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A response status that retrying can't fix; propagates immediately. */
class NonRetryableFetchError extends Error {}

/**
 * 5xx are transient; 408 (request timeout) and 429 (rate limit) explicitly ask
 * to retry. Every other 4xx is a client error a retry won't heal (404 missing
 * skill, 403 bad token) — retrying only burns the backoff before failing.
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export interface RetryOpts {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
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
    sleepImpl = sleep,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs = DEFAULT_BACKOFF_MS,
  } = opts;

  const failures: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) return resp;
      const msg = `HTTP ${resp.status} ${resp.statusText}`;
      if (!isRetryableStatus(resp.status)) {
        throw new NonRetryableFetchError(`fetch ${url} failed — ${msg}`);
      }
      throw new Error(msg);
    } catch (err: any) {
      if (err instanceof NonRetryableFetchError) throw err;
      failures.push(`attempt ${attempt}: ${err.message}`);
      if (attempt < maxAttempts) {
        await sleepImpl(backoffMs * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`fetch ${url} failed — ${failures.join('; ')}`);
}
