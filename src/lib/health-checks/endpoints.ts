import { REMOTE_SKILLS_BASE_URL } from '@lib/constants';
import { logToFile } from '@utils/debug';
import { ServiceHealthStatus, type BaseHealthResult } from './types';

// ---------------------------------------------------------------------------
// Direct endpoint health checks
//
// These ping PostHog-owned services directly (no Statuspage intermediary).
// A non-expected HTTP status or any network error is treated as Down.
//
// LLM Gateway – FastAPI service
//   Source: posthog/services/llm-gateway/src/llm_gateway/api/health.py
//   GET /_liveness → 200 {"status":"alive"}
//
// MCP – Cloudflare Worker
//   Source: posthog/services/mcp/src/index.ts
//   GET / → 302 to posthog.com docs. The redirect proves the worker is up.
// ---------------------------------------------------------------------------

function downResult(error: string): BaseHealthResult {
  return { status: ServiceHealthStatus.Down, error };
}

async function fetchEndpointHealth(
  url: string,
  timeoutMs = 5000,
  isExpectedStatus: (status: number) => boolean = (s) => s === 200,
  redirect: 'follow' | 'manual' | 'error' = 'follow',
): Promise<BaseHealthResult> {
  const result = await (async (): Promise<BaseHealthResult> => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect,
      });
      clearTimeout(tid);

      if (isExpectedStatus(res.status)) {
        return {
          status: ServiceHealthStatus.Healthy,
          rawIndicator: `HTTP ${res.status}`,
        };
      }
      return downResult(`HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError')
        return downResult(`Request timed out after ${timeoutMs}ms`);
      return downResult(e instanceof Error ? e.message : 'Unknown error');
    }
  })();

  logToFile(
    `[health-checks] GET ${url} -> ${result.status}` +
      `${result.rawIndicator ? ` (${result.rawIndicator})` : ''}` +
      `${result.error ? ` (${result.error})` : ''}`,
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
