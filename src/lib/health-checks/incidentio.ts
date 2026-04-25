import {
  ServiceHealthStatus,
  type BaseHealthResult,
  type ComponentHealthResult,
  type ComponentStatus,
} from './types';

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

function mapComponentStatus(status: string): ServiceHealthStatus {
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

function errResult(error: string): BaseHealthResult {
  return { status: ServiceHealthStatus.Degraded, error };
}

const POSTHOG_STATUS_URL = 'https://www.posthogstatus.com/api/v1/summary';

async function fetchPosthogStatus(
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

    let worstOverall = ServiceHealthStatus.Degraded;
    const affected: ComponentStatus[] = [];

    for (const incident of incidents) {
      const impact = mapIncidentImpact(incident.current_worst_impact);
      if (impact === ServiceHealthStatus.Down) {
        worstOverall = ServiceHealthStatus.Down;
      }

      for (const comp of incident.affected_components ?? []) {
        const compStatus = mapComponentStatus(comp.current_status);
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

let _cache: Promise<{
  overall: BaseHealthResult;
  components: ComponentHealthResult;
}> | null = null;

function getPosthogHealth() {
  if (!_cache) _cache = fetchPosthogStatus();
  return _cache;
}

export function resetPosthogHealthCache(): void {
  _cache = null;
}

export const checkPosthogOverallHealth = async (): Promise<BaseHealthResult> =>
  (await getPosthogHealth()).overall;

export const checkPosthogComponentHealth =
  async (): Promise<ComponentHealthResult> =>
    (await getPosthogHealth()).components;
