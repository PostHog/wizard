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
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      return resp;
    } catch (err: any) {
      failures.push(`attempt ${attempt}: ${err.message}`);
      if (attempt < maxAttempts) {
        await sleepImpl(backoffMs * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`fetch ${url} failed — ${failures.join('; ')}`);
}
