import { AWS_SKILLS_BASE_URL, GITHUB_SKILLS_BASE_URL } from '@lib/constants';
import { logToFile } from '@utils/debug';
import { ServiceHealthStatus, type BaseHealthResult } from './types';

// ---------------------------------------------------------------------------
// Direct endpoint health checks
//
// These ping PostHog-owned services directly (no Statuspage intermediary).
// Result taxonomy:
//   - HTTP 2xx-3xx (per `isExpectedStatus`)        → Healthy
//   - HTTP 4xx / 5xx                                → Down (confirmed)
//   - Network error / DNS / timeout (after retries) → NoConnection
// NoConnection means we don't know whose fault it is; readiness reconciles
// against the status page before deciding how to surface it to the user.
//
// LLM Gateway – FastAPI service
//   Source: posthog/services/llm-gateway/src/llm_gateway/api/health.py
//   GET /_liveness → 200 {"status":"alive"}
//
// MCP – Cloudflare Worker
//   Source: posthog/services/mcp/src/index.ts
//   GET / → 302 to posthog.com docs. The redirect proves the worker is up.
//
// Skills download – context-mill releases
//   GET <origin>/skill-menu.json on both origins; see checkSkillsOriginHealth.
// ---------------------------------------------------------------------------

function noConnectionResult(error: string, attempts: number): BaseHealthResult {
  return {
    status: ServiceHealthStatus.NoConnection,
    error,
    rawIndicator: attempts > 1 ? `attempts=${attempts}` : undefined,
  };
}

function downResult(error: string): BaseHealthResult {
  return { status: ServiceHealthStatus.Down, error };
}

// Backoffs sized to cover typical wifi flakiness — a single dropped
// packet recovers via the 500ms retry; a wifi access point reconnect
// or wifi↔LTE handoff (2-5s) is caught by the 2000ms retry. Tighter
// schedules miss multi-second blips because all retries land in the
// same dead window.
const RETRY_BACKOFFS_MS = [500, 2000];

async function attemptFetch(
  url: string,
  timeoutMs: number,
  redirect: 'follow' | 'manual' | 'error',
): Promise<
  | { kind: 'response'; res: Response }
  | { kind: 'error'; error: Error; timedOut: boolean }
> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect });
    clearTimeout(tid);
    return { kind: 'response', res };
  } catch (e) {
    clearTimeout(tid);
    const err = e instanceof Error ? e : new Error('Unknown error');
    return { kind: 'error', error: err, timedOut: err.name === 'AbortError' };
  }
}

async function fetchEndpointHealth(
  url: string,
  timeoutMs = 5000,
  isExpectedStatus: (status: number) => boolean = (s) => s === 200,
  redirect: 'follow' | 'manual' | 'error' = 'follow',
): Promise<BaseHealthResult> {
  // Total attempts = 1 initial + RETRY_BACKOFFS_MS.length retries. Both
  // unexpected HTTP statuses (4xx/5xx) and network errors trigger a retry:
  // transient 5xx and Cloudflare edge blips often recover on a retry, and
  // even nominally deterministic 4xx can be transient (CDN propagation
  // lag after a release, token rotation, rate-limit window resets). GETs
  // are idempotent so retrying is safe.
  //
  // Final status if every attempt fails:
  //   - At least one HTTP response observed → `Down` (server-side evidence)
  //   - Only network errors observed         → `NoConnection`
  let lastHttpStatus: number | null = null;
  let lastError = 'Unknown error';
  let attempts = 0;

  for (let i = 0; i <= RETRY_BACKOFFS_MS.length; i++) {
    if (i > 0) {
      const wait = RETRY_BACKOFFS_MS[i - 1];
      logToFile(
        `[health-checks] retry ${i}/${RETRY_BACKOFFS_MS.length} for ${url} in ${wait}ms (last: ${lastError})`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
    attempts++;

    const outcome = await attemptFetch(url, timeoutMs, redirect);

    if (outcome.kind === 'response') {
      const res = outcome.res;
      if (isExpectedStatus(res.status)) {
        const result: BaseHealthResult = {
          status: ServiceHealthStatus.Healthy,
          rawIndicator:
            attempts > 1
              ? `HTTP ${res.status} (attempts=${attempts})`
              : `HTTP ${res.status}`,
        };
        logToFile(
          `[health-checks] GET ${url} -> ${result.status}` +
            ` (${result.rawIndicator})`,
        );
        return result;
      }
      lastHttpStatus = res.status;
      lastError = `HTTP ${res.status}`;
      continue;
    }

    lastError = outcome.timedOut
      ? `Request timed out after ${timeoutMs}ms`
      : outcome.error.message;
  }

  const result =
    lastHttpStatus !== null
      ? downResult(
          `HTTP ${lastHttpStatus} (attempts=${attempts})`,
          lastHttpStatus,
        )
      : noConnectionResult(lastError, attempts);
  logToFile(
    `[health-checks] GET ${url} -> ${result.status}` +
      ` (attempts=${attempts}, ${result.error})`,
  );
  return result;
}

export const checkLlmGatewayHealth = (): Promise<BaseHealthResult> =>
  fetchEndpointHealth('https://gateway.us.posthog.com/_liveness');

export const checkMcpHealth = (): Promise<BaseHealthResult> =>
  fetchEndpointHealth(
    'https://mcp.posthog.com/',
    5000,
    // 2xx-3xx counts as up (redirect to docs)
    (s) => s >= 200 && s < 400,
    'manual',
  );

/**
 * Skills are published to two origins under the same filenames and
 * `fetchWithRetry` fails over between them, so the run is only blocked when
 * neither answers. Probed in parallel — sequential probes would double the
 * worst case past `READINESS_TIMEOUT_MS`.
 */
export const checkSkillsOriginHealth = async (): Promise<BaseHealthResult> => {
  const [github, aws] = await Promise.all([
    fetchEndpointHealth(`${GITHUB_SKILLS_BASE_URL}/skill-menu.json`),
    fetchEndpointHealth(`${AWS_SKILLS_BASE_URL}/skill-menu.json`),
  ]);
  return combineOriginHealth(github, aws);
};

/**
 * Mirrors `fetchWithRetry`: a download tries GitHub, then AWS, so the run is
 * only blocked when neither origin answers. Whichever failure the probes saw,
 * one origin serving means skills are reachable.
 */
function combineOriginHealth(
  github: BaseHealthResult,
  aws: BaseHealthResult,
): BaseHealthResult {
  if (github.status === ServiceHealthStatus.Healthy) {
    // Naming the dead origin makes a one-sided outage legible in the log and
    // in the readiness reasons, where the status alone reads as "fine".
    return aws.status === ServiceHealthStatus.Healthy
      ? github
      : withIndicatorSuffix(github, 'aws unavailable');
  }

  if (aws.status === ServiceHealthStatus.Healthy) {
    return withIndicatorSuffix(aws, 'via aws, github unavailable');
  }

  const error = `github: ${github.error ?? 'unknown'} | aws: ${
    aws.error ?? 'unknown'
  }`;
  const confirmedDown =
    github.status === ServiceHealthStatus.Down ||
    aws.status === ServiceHealthStatus.Down;
  return {
    status: confirmedDown
      ? ServiceHealthStatus.Down
      : ServiceHealthStatus.NoConnection,
    error,
    // Keeps the `attempts=N` the blocked-readiness analytics parses.
    rawIndicator: github.rawIndicator ?? aws.rawIndicator,
  };
}

function withIndicatorSuffix(
  result: BaseHealthResult,
  suffix: string,
): BaseHealthResult {
  return {
    ...result,
    rawIndicator: result.rawIndicator
      ? `${result.rawIndicator} (${suffix})`
      : suffix,
  };
}
