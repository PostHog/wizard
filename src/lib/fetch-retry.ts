/**
 * One retry + failover policy for every critical-path fetch. GitHub is primary,
 * AWS is the fallback. A status a retry can't heal (404, 403) spends no retry
 * budget at the origin that returned it — but it still costs the other origin
 * one try, because the two are published separately and GitHub 403s expired
 * asset redirects and blocked regions where the asset is present.
 */

import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { CONTEXT_MILL_URL, AWS_SKILLS_BASE_URL } from './constants';

const DEFAULT_TIMEOUT_MS = 60000; // per attempt
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 500; // doubles each retry

const GITHUB_LATEST_PREFIX = `${CONTEXT_MILL_URL}/releases/latest/download/`;
const GITHUB_PINNED_PREFIX = `${CONTEXT_MILL_URL}/releases/download/`;
/** Version-pinned URLs name their own prefix, so they need the host alone. */
const AWS_ORIGIN = new URL(AWS_SKILLS_BASE_URL).origin;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Maps a context-mill release URL onto AWS; null when there is no second origin.
 *
 *   .../releases/latest/download/x.zip  ->  <aws>/latest/x.zip
 *   .../releases/download/v1.50.0/x.zip ->  <aws>/v1.50.0/x.zip
 */
export function awsUrlFor(url: string): string | null {
  if (url.startsWith(GITHUB_LATEST_PREFIX)) {
    return `${AWS_SKILLS_BASE_URL}/${url.slice(GITHUB_LATEST_PREFIX.length)}`;
  }
  if (url.startsWith(GITHUB_PINNED_PREFIX)) {
    return `${AWS_ORIGIN}/${url.slice(GITHUB_PINNED_PREFIX.length)}`;
  }
  return null;
}

/** The two origins context-mill releases are published to. */
export type SkillsOrigin = 'github' | 'aws';

/** Sticky: without it every asset re-pays GitHub's retry budget during an outage. */
let preferredOrigin: SkillsOrigin = 'github';

/** Test seam — the preference deliberately outlives a single call. */
export function resetOriginPreference(): void {
  preferredOrigin = 'github';
}

/** A response status that retrying can't fix; propagates past the retry loop. */
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
  /** Set false to fail rather than reach for AWS. */
  failover?: boolean;
  /** Test seam for the failover/exhausted events. */
  onEvent?: (event: string, props: Record<string, unknown>) => void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Try one origin to exhaustion. */
async function fetchOrigin(
  url: string,
  opts: Required<Pick<RetryOpts, 'timeoutMs' | 'maxAttempts' | 'backoffMs'>> & {
    fetchImpl: typeof fetch;
    sleepImpl: (ms: number) => Promise<void>;
  },
): Promise<Response> {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const resp = await opts.fetchImpl(url, {
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (resp.ok) return resp;
      const msg = `HTTP ${resp.status} ${resp.statusText}`.trim();
      if (!isRetryableStatus(resp.status))
        throw new NonRetryableFetchError(msg);
      throw new Error(msg);
    } catch (err) {
      if (err instanceof NonRetryableFetchError) throw err;
      failures.push(`attempt ${attempt}: ${messageOf(err)}`);
      if (attempt < opts.maxAttempts) {
        await opts.sleepImpl(opts.backoffMs * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(failures.join('; '));
}

/**
 * Retry with backoff, then fail over. Throws once every origin is exhausted.
 */
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
    failover = true,
    onEvent = (event, props) => analytics.wizardCapture(event, props),
  } = opts;
  const originOpts = {
    fetchImpl,
    sleepImpl,
    timeoutMs,
    maxAttempts,
    backoffMs,
  };

  const awsUrl = failover ? awsUrlFor(url) : null;
  if (!awsUrl) {
    try {
      return await fetchOrigin(url, originOpts);
    } catch (err) {
      throw new Error(`fetch ${url} failed — ${messageOf(err)}`);
    }
  }

  // Sticky: whichever origin last worked is tried first for the rest of the run.
  const order: Array<{ origin: SkillsOrigin; target: string }> =
    preferredOrigin === 'aws'
      ? [
          { origin: 'aws', target: awsUrl },
          { origin: 'github', target: url },
        ]
      : [
          { origin: 'github', target: url },
          { origin: 'aws', target: awsUrl },
        ];

  const failures: string[] = [];
  for (const [index, candidate] of order.entries()) {
    try {
      const resp = await fetchOrigin(candidate.target, originOpts);
      if (candidate.origin !== preferredOrigin) {
        // The transition is the interesting event, not every later fetch.
        preferredOrigin = candidate.origin;
        logToFile(`fetchWithRetry: failed over to ${candidate.origin}`);
        onEvent('skills fetch failed over', {
          origin: candidate.origin,
          url: candidate.target,
        });
      }
      return resp;
    } catch (err) {
      // Non-retryable here still means "ask the other origin" — they are
      // published separately, and a 403 is as often about us as the asset.
      failures.push(`${candidate.origin}: ${messageOf(err)}`);
      if (index === order.length - 1) {
        onEvent('skills fetch failed', { url, failures: failures.length });
      }
    }
  }
  throw new Error(`fetch ${url} failed — ${failures.join(' | ')}`);
}
