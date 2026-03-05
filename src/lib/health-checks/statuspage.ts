import {
  ServiceHealthStatus,
  type BaseHealthResult,
  type ComponentHealthResult,
} from './types';

// ---------------------------------------------------------------------------
// Statuspage.io v2 API helpers
// https://metastatuspage.com/api
//
// status.json  – page-level rollup; indicator is one of: none | minor | major | critical
// summary.json – same rollup + component list; component status is one of:
//   operational | degraded_performance | partial_outage | major_outage | under_maintenance
//   https://support.atlassian.com/statuspage/docs/show-service-status-with-components
// ---------------------------------------------------------------------------

interface StatuspageStatusResponse {
  status?: { indicator?: string; description?: string };
}

interface StatuspageSummaryResponse extends StatuspageStatusResponse {
  components?: { id: string; name: string; status: string }[];
}

function mapIndicator(v: string | null | undefined): ServiceHealthStatus {
  switch (v) {
    case 'none':
      return ServiceHealthStatus.Healthy;
    case 'minor':
      return ServiceHealthStatus.Degraded;
    case 'major':
    case 'critical':
      return ServiceHealthStatus.Down;
    default:
      return ServiceHealthStatus.Degraded;
  }
}

function mapComponentRaw(v: string | null | undefined): ServiceHealthStatus {
  switch (v) {
    case 'operational':
      return ServiceHealthStatus.Healthy;
    case 'degraded_performance':
    case 'under_maintenance':
      return ServiceHealthStatus.Degraded;
    case 'partial_outage':
    case 'major_outage':
      return ServiceHealthStatus.Down;
    default:
      return ServiceHealthStatus.Degraded;
  }
}

function errResult(error: string): BaseHealthResult {
  return { status: ServiceHealthStatus.Degraded, error };
}

async function fetchStatuspageIndicator(
  url: string,
  timeoutMs = 5000,
): Promise<BaseHealthResult> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);

    if (!res.ok) return errResult(`HTTP ${res.status}`);

    const data = (await res.json()) as StatuspageStatusResponse;
    const indicator = data.status?.indicator ?? null;
    return {
      status: mapIndicator(indicator),
      rawIndicator: indicator ?? undefined,
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      return errResult('Request timed out');
    return errResult(e instanceof Error ? e.message : 'Unknown error');
  }
}

async function fetchStatuspageSummary(
  url: string,
  timeoutMs = 5000,
): Promise<ComponentHealthResult> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);

    if (!res.ok) return errResult(`HTTP ${res.status}`);

    const data = (await res.json()) as StatuspageSummaryResponse;
    const indicator = data.status?.indicator ?? null;
    const overall = mapIndicator(indicator);

    const affected = (data.components ?? [])
      .map((c) => ({
        name: c.name,
        status: mapComponentRaw(c.status),
        rawStatus: c.status,
      }))
      .filter((c) => c.status !== ServiceHealthStatus.Healthy);

    return {
      status: affected.length > 0 ? ServiceHealthStatus.Degraded : overall,
      rawIndicator: indicator ?? undefined,
      degradedOrDownComponents: affected.length > 0 ? affected : undefined,
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      return errResult('Request timed out');
    return errResult(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ---------------------------------------------------------------------------
// Individual statuspage-backed checks
// ---------------------------------------------------------------------------

export const checkAnthropicHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator('https://status.claude.com/api/v2/status.json');

export const checkPosthogOverallHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator('https://www.posthogstatus.com/api/v2/status.json');

export const checkPosthogComponentHealth = (): Promise<ComponentHealthResult> =>
  fetchStatuspageSummary('https://www.posthogstatus.com/api/v2/summary.json');

export const checkGithubHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator('https://www.githubstatus.com/api/v2/status.json');

export const checkNpmOverallHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator('https://status.npmjs.org/api/v2/status.json');

export const checkNpmComponentHealth = (): Promise<ComponentHealthResult> =>
  fetchStatuspageSummary('https://status.npmjs.org/api/v2/summary.json');

export const checkCloudflareOverallHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator(
    'https://www.cloudflarestatus.com/api/v2/status.json',
  );

export const checkCloudflareComponentHealth =
  (): Promise<ComponentHealthResult> =>
    fetchStatuspageSummary(
      'https://www.cloudflarestatus.com/api/v2/summary.json',
    );
