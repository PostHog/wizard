import { REMOTE_SKILLS_BASE_URL } from '@lib/constants';
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
  // Total attempts = 1 initial + RETRY_BACKOFFS_MS.length retries. Only
  // network/timeout errors trigger a retry — explicit HTTP responses are
  // deterministic so retrying them is wasted time and a worse spinner.
  let lastError = 'Unknown error';
  let attempts = 0;

  for (let i = 0; i <= RETRY_BACKOFFS_MS.length; i++) {
    if (i > 0) {
      const wait = RETRY_BACKOFFS_MS[i - 1];
      logToFile(
        `[health-checks] retry ${i}/${RETRY_BACKOFFS_MS.length} for ${url} in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
    attempts++;

    const outcome = await attemptFetch(url, timeoutMs, redirect);

    if (outcome.kind === 'response') {
      const res = outcome.res;
      const result: BaseHealthResult = isExpectedStatus(res.status)
        ? {
            status: ServiceHealthStatus.Healthy,
            rawIndicator:
              attempts > 1
                ? `HTTP ${res.status} (attempts=${attempts})`
                : `HTTP ${res.status}`,
          }
        : downResult(`HTTP ${res.status}`);
      logToFile(
        `[health-checks] GET ${url} -> ${result.status}` +
          `${result.rawIndicator ? ` (${result.rawIndicator})` : ''}` +
          `${result.error ? ` (${result.error})` : ''}`,
      );
      return result;
    }

    lastError = outcome.timedOut
      ? `Request timed out after ${timeoutMs}ms`
      : outcome.error.message;
  }

  const result = noConnectionResult(lastError, attempts);
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

export const checkGithubReleasesHealth = (): Promise<BaseHealthResult> =>
  fetchEndpointHealth(`${REMOTE_SKILLS_BASE_URL}/skill-menu.json`);
