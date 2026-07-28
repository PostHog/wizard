/**
 * Bounded retry with exponential backoff.
 *
 * Machinery only: it knows nothing about HTTP, PostHog, or what makes a given
 * failure transient. Callers supply the operation and (optionally) a
 * `shouldRetry` predicate; `fetch-retry.ts` wraps it for the skills server and
 * `provisioning.ts` for the signup POSTs.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = 500; // doubles each retry

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryPolicy {
  /** Total attempts, including the first. */
  maxAttempts?: number;
  /** Delay before the second attempt; doubles for each one after. */
  backoffMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Return false to fail fast on this error. Defaults to retrying everything. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called after every failed attempt, before any backoff. */
  onAttemptError?: (error: unknown, attempt: number) => void;
}

/**
 * Run `operation`, retrying failures with backoff. Rethrows the last error once
 * the attempts are exhausted or `shouldRetry` declines, so callers keep the
 * original error (code, `cause`, response) to key their own handling off.
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs = DEFAULT_BACKOFF_MS,
    sleepImpl = sleep,
    shouldRetry = () => true,
    onAttemptError,
  } = policy;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      onAttemptError?.(error, attempt);
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) break;
      await sleepImpl(backoffMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
