import {
  ServiceHealthStatus,
  type BaseHealthResult,
  type ComponentHealthResult,
  type ComponentStatus,
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

// ---------------------------------------------------------------------------
// PostHog status (incident.io v1 API)
// https://www.posthogstatus.com/api/v1/summary
// ---------------------------------------------------------------------------

interface IncidentIoAffectedComponent {
  id: string;
  name: string;
  group_name?: string;
  current_status: string;
}

interface IncidentIoIncident {
  id: string;
  name: string;
  status: string;
  current_worst_impact: string;
  affected_components: IncidentIoAffectedComponent[];
}

interface IncidentIoSummary {
  ongoing_incidents: IncidentIoIncident[];
  in_progress_maintenances: unknown[];
}

function mapIncidentImpact(impact: string): ServiceHealthStatus {
  switch (impact) {
    case 'full_outage':
      return ServiceHealthStatus.Down;
    case 'partial_outage':
    case 'degraded_performance':
      return ServiceHealthStatus.Degraded;
    default:
      return ServiceHealthStatus.Degraded;
  }
}

function mapIncidentIoComponentStatus(status: string): ServiceHealthStatus {
  switch (status) {
    case 'operational':
      return ServiceHealthStatus.Healthy;
    case 'full_outage':
      return ServiceHealthStatus.Down;
    case 'partial_outage':
    case 'degraded_performance':
      return ServiceHealthStatus.Degraded;
    default:
      return ServiceHealthStatus.Degraded;
  }
}

const POSTHOG_STATUS_URL = 'https://www.posthogstatus.com/api/v1/summary';

async function fetchPosthogIncidentIo(
  timeoutMs = 5000,
): Promise<{ overall: BaseHealthResult; components: ComponentHealthResult }> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(POSTHOG_STATUS_URL, { signal: controller.signal });
    clearTimeout(tid);

    if (!res.ok) {
      const err = errResult(`HTTP ${res.status}`);
      return { overall: err, components: err };
    }

    const data = (await res.json()) as IncidentIoSummary;
    const incidents = data.ongoing_incidents ?? [];

    if (incidents.length === 0) {
      return {
        overall: { status: ServiceHealthStatus.Healthy },
        components: { status: ServiceHealthStatus.Healthy },
      };
    }

    // Overall status = worst impact across all incidents
    let worstOverall = ServiceHealthStatus.Degraded;
    const affected: ComponentStatus[] = [];

    for (const incident of incidents) {
      const impact = mapIncidentImpact(incident.current_worst_impact);
      if (impact === ServiceHealthStatus.Down) {
        worstOverall = ServiceHealthStatus.Down;
      }

      for (const comp of incident.affected_components ?? []) {
        const compStatus = mapIncidentIoComponentStatus(comp.current_status);
        if (compStatus !== ServiceHealthStatus.Healthy) {
          affected.push({
            name: comp.group_name
              ? `${comp.group_name} — ${comp.name}`
              : comp.name,
            status: compStatus,
            rawStatus: comp.current_status,
          });
        }
      }
    }

    return {
      overall: { status: worstOverall },
      components: {
        status:
          affected.length > 0 ? ServiceHealthStatus.Degraded : worstOverall,
        degradedOrDownComponents: affected.length > 0 ? affected : undefined,
      },
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      const err = errResult('Request timed out');
      return { overall: err, components: err };
    }
    const err = errResult(e instanceof Error ? e.message : 'Unknown error');
    return { overall: err, components: err };
  }
}

let _posthogCache: Promise<{
  overall: BaseHealthResult;
  components: ComponentHealthResult;
}> | null = null;

function getPosthogHealth() {
  if (!_posthogCache) _posthogCache = fetchPosthogIncidentIo();
  return _posthogCache;
}

export function resetPosthogHealthCache(): void {
  _posthogCache = null;
}

export const checkPosthogOverallHealth = async (): Promise<BaseHealthResult> =>
  (await getPosthogHealth()).overall;

export const checkPosthogComponentHealth =
  async (): Promise<ComponentHealthResult> =>
    (await getPosthogHealth()).components;

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
