/**
 * ServiceHealthList — Shared component for displaying service health status.
 *
 * Used by HealthCheckScreen (blocking services only) and HealthWarningsTab (all services).
 */

import { Box, Text } from 'ink';
import {
  ServiceHealthStatus,
  type AllServicesHealth,
  type ComponentHealthResult,
  type ComponentStatus,
  type HealthCheckKey,
} from '../../../lib/health-checks/types.js';
import { SERVICE_LABELS } from '../../../lib/health-checks/readiness.js';
import { Icons } from '../styles.js';

/** Keys that are component-level detail — shown inline under their parent. */
const COMPONENT_KEYS: HealthCheckKey[] = [
  'posthogComponents',
  'npmComponents',
  'cloudflareComponents',
];

/** Map component key → its parent "overall" key */
const COMPONENT_PARENT: Partial<Record<HealthCheckKey, HealthCheckKey>> = {
  posthogComponents: 'posthogOverall',
  npmComponents: 'npmOverall',
  cloudflareComponents: 'cloudflareOverall',
};

function statusIcon(status: ServiceHealthStatus): {
  icon: string;
  color: string;
} {
  switch (status) {
    case ServiceHealthStatus.Down:
      return { icon: Icons.squareFilled, color: 'red' };
    case ServiceHealthStatus.Degraded:
      return { icon: Icons.squareFilled, color: '#DC9300' };
    case ServiceHealthStatus.Healthy:
      return { icon: Icons.check, color: 'green' };
  }
}

interface ServiceHealthListProps {
  health: AllServicesHealth;
  /** If set, only show services with these keys */
  filterKeys?: HealthCheckKey[];
  /** Show healthy services (default true) */
  showHealthy?: boolean;
}

export const ServiceHealthList = ({
  health,
  filterKeys,
  showHealthy = true,
}: ServiceHealthListProps) => {
  const topLevelKeys = (Object.keys(health) as HealthCheckKey[]).filter(
    (k) => !COMPONENT_KEYS.includes(k),
  );

  const keysToShow = filterKeys
    ? topLevelKeys.filter((k) => filterKeys.includes(k))
    : topLevelKeys;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {keysToShow.map((key) => {
        const result = health[key];
        if (!showHealthy && result.status === ServiceHealthStatus.Healthy) {
          return null;
        }

        const { icon, color } = statusIcon(result.status);
        const label = SERVICE_LABELS[key];

        // Find component-level details if this is a parent key
        const componentKey = (
          Object.entries(COMPONENT_PARENT) as [HealthCheckKey, HealthCheckKey][]
        ).find(([, parent]) => parent === key)?.[0];
        const componentResult = componentKey
          ? (health[componentKey] as ComponentHealthResult)
          : undefined;
        const affectedComponents: ComponentStatus[] =
          componentResult?.degradedOrDownComponents ?? [];

        return (
          <Box key={key} flexDirection="column">
            <Text>
              <Text color={color}>{icon}</Text>{' '}
              <Text bold={result.status !== ServiceHealthStatus.Healthy}>
                {label}
              </Text>
            </Text>
            {affectedComponents.length > 0 && (
              <Box flexDirection="column" paddingLeft={3}>
                {affectedComponents.slice(0, 5).map((c) => {
                  const ci = statusIcon(c.status);
                  return (
                    <Text key={c.name} dimColor>
                      <Text color={ci.color}>{ci.icon}</Text> {c.name}
                    </Text>
                  );
                })}
                {affectedComponents.length > 5 && (
                  <Text dimColor>+{affectedComponents.length - 5} more</Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
