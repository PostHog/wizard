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
//   GET / → 200 (HTML landing page)
// ---------------------------------------------------------------------------

function downResult(error: string): BaseHealthResult {
  return { status: ServiceHealthStatus.Down, error };
}

async function fetchEndpointHealth(
  url: string,
  timeoutMs = 5000,
  expectedStatus = 200,
): Promise<BaseHealthResult> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);

    if (res.status === expectedStatus) {
      return {
        status: ServiceHealthStatus.Healthy,
        rawIndicator: `HTTP ${res.status}`,
      };
    }
    return downResult(`HTTP ${res.status}`);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      return downResult('Request timed out');
    return downResult(e instanceof Error ? e.message : 'Unknown error');
  }
}

export const checkLlmGatewayHealth = (): Promise<BaseHealthResult> =>
  fetchEndpointHealth('https://gateway.us.posthog.com/_liveness');

export const checkMcpHealth = (): Promise<BaseHealthResult> =>
  fetchEndpointHealth('https://mcp.posthog.com/');
