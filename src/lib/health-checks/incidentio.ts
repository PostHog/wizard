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

/**
 * Build an error result for fetch failures. The kind matters for
 * downstream reconciliation:
 *
 *   - 'http' (incident.io returned a bad status code) → `Down`. We
 *     reached the status page but it told us something is wrong on
 *     its side. We have a definitive response.
 *   - 'network' (timeout, DNS failure, TCP/TLS failure) → `NoConnection`.
 *     We never reached the status page. Treating this as `Degraded`
 *     (the previous behavior) silently flipped the reconciliation in
 *     `readiness.ts` from "soft" to "confirmed outage" whenever the
 *     user's own network was flaky — exactly the false positive this
 *     module is meant to help diagnose.
 */
function errResult(error: string, kind: 'http' | 'network'): BaseHealthResult {
  return {
    status:
      kind === 'http'
        ? ServiceHealthStatus.Down
        : ServiceHealthStatus.NoConnection,
    error,
  };
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
      const err = errResult(`HTTP ${res.status}`, 'http');
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
      const err = errResult('Request timed out', 'network');
      return { overall: err, components: err };
    }
    const err = errResult(
      e instanceof Error ? e.message : 'Unknown error',
      'network',
    );
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
