import type { ReadinessOutageInfo } from './wizard-session.js';
import {
  DEFAULT_WIZARD_READINESS_CONFIG,
  SERVICE_LABELS,
  type WizardReadinessResult,
} from './health-checks/index.js';
import type {
  HealthCheckKey,
  ComponentHealthResult,
} from './health-checks/index.js';
import { logToFile } from '../utils/debug.js';
import { getUI } from '../ui/index.js';

export function mapReadinessToOutageInfo(
  readiness: WizardReadinessResult,
): ReadinessOutageInfo {
  const decision =
    readiness.decision === 'yes'
      ? 'yes'
      : readiness.decision === 'no'
      ? 'no'
      : 'yes_with_warnings';

  const health = readiness.health;
  const services = (Object.keys(health) as HealthCheckKey[]).map((key) => ({
    label: SERVICE_LABELS[key],
    status: health[key].status as 'healthy' | 'degraded' | 'down',
  }));

  const componentDetails = (Object.keys(health) as HealthCheckKey[])
    .filter(
      (key): key is HealthCheckKey => 'degradedOrDownComponents' in health[key],
    )
    .map((key) => {
      const result = health[key] as ComponentHealthResult;
      const items = (result.degradedOrDownComponents ?? []).map((c) => ({
        name: c.name,
        status: c.status as string,
      }));
      return { serviceLabel: SERVICE_LABELS[key], items };
    })
    .filter((d) => d.items.length > 0);

  const posthogSubItems = [
    { label: 'LLM Gateway', status: health.llmGateway.status as string },
    { label: 'MCP', status: health.mcp.status as string },
  ];

  return {
    decision,
    reasons: readiness.reasons,
    services,
    componentDetails,
    posthogSubItems,
  };
}

export function logReadinessDebug(readiness: WizardReadinessResult): void {
  const readinessSummary = `Readiness decision: ${
    readiness.decision
  } (downBlocksRun=${DEFAULT_WIZARD_READINESS_CONFIG.downBlocksRun.join(
    ',',
  )}; degradedBlocksRun=${(
    DEFAULT_WIZARD_READINESS_CONFIG.degradedBlocksRun ?? []
  ).join(',')})`;

  getUI().log.info(readinessSummary);
  logToFile('[Readiness]', readinessSummary);

  for (const key of Object.keys(readiness.health) as HealthCheckKey[]) {
    const h = readiness.health[key];
    const label = SERVICE_LABELS[key];
    const extraParts = [];
    if (h.rawIndicator) extraParts.push(`indicator=${h.rawIndicator}`);
    if (h.error) extraParts.push(h.error);
    const extra = extraParts.length ? ` — ${extraParts.join(' ')}` : '';
    const line = `Health[${label}]: ${h.status}${extra}`;
    getUI().log.info(line);
    logToFile('[Readiness]', line);
  }
}
