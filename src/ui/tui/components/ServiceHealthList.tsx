// Display the dependencies reported by the health check.

import { Box, Text } from 'ink';
import {
  ServiceHealthStatus,
  type AllServicesHealth,
  type HealthCheckKey,
} from '@lib/health-checks/types';
import { SERVICE_LABELS } from '@lib/health-checks/readiness';
import { Icons } from '@ui/tui/styles';

function statusIcon(status: ServiceHealthStatus): {
  icon: string;
  color: string;
} {
  switch (status) {
    case ServiceHealthStatus.Down:
      return { icon: Icons.squareFilled, color: 'red' };
    case ServiceHealthStatus.Degraded:
      return { icon: Icons.squareFilled, color: '#DC9300' };
    case ServiceHealthStatus.NoConnection:
      return { icon: Icons.squareFilled, color: 'gray' };
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
  const topLevelKeys = Object.keys(health) as HealthCheckKey[];

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

        return (
          <Box key={key} flexDirection="column">
            <Text>
              <Text color={color}>{icon}</Text>{' '}
              <Text bold={result.status !== ServiceHealthStatus.Healthy}>
                {label}
              </Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
