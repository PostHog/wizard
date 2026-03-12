/**
 * HealthCheckDemo — Playground demo for health check UI components.
 *
 * Shows the ModalOverlay with ServiceHealthList, cycling through states:
 *   1. Checking (spinner) — 2 seconds
 *   2. Blocking outage modal (Anthropic down, npm degraded)
 *
 * Renders components directly (not HealthCheckScreen) to avoid useInput
 * conflicts with TabContainer's key handling.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { LoadingBox, ModalOverlay } from '../../primitives/index.js';
import { Icons } from '../../styles.js';
import { ServiceHealthList } from '../../components/ServiceHealthList.js';
import { getBlockingServiceKeys } from '../../../../lib/health-checks/readiness.js';
import { ServiceHealthStatus } from '../../../../lib/health-checks/types.js';
import type { AllServicesHealth } from '../../../../lib/health-checks/types.js';

const HEALTHY = { status: ServiceHealthStatus.Healthy } as const;

const MOCK_HEALTH: AllServicesHealth = {
  anthropic: { status: ServiceHealthStatus.Down, rawIndicator: 'major' },
  posthogOverall: HEALTHY,
  posthogComponents: { status: ServiceHealthStatus.Healthy },
  github: HEALTHY,
  npmOverall: {
    status: ServiceHealthStatus.Degraded,
    rawIndicator: 'minor',
  },
  npmComponents: {
    status: ServiceHealthStatus.Degraded,
    degradedOrDownComponents: [
      {
        name: 'Registry API',
        status: ServiceHealthStatus.Degraded,
        rawStatus: 'degraded_performance',
      },
    ],
  },
  cloudflareOverall: HEALTHY,
  cloudflareComponents: { status: ServiceHealthStatus.Healthy },
  llmGateway: HEALTHY,
  mcp: HEALTHY,
};

export const HealthCheckDemo = () => {
  const [showOutage, setShowOutage] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowOutage(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!showOutage) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <LoadingBox message="Checking service status..." />
      </Box>
    );
  }

  const blockingKeys = getBlockingServiceKeys(MOCK_HEALTH);

  return (
    <ModalOverlay
      borderColor="red"
      title={`${Icons.warning} Ongoing service disruptions`}
      width={72}
      footer={
        <Box marginLeft={2}>
          <Text dimColor>
            Continue [Enter] / Exit [Esc] (disabled in playground)
          </Text>
        </Box>
      }
    >
      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Text>
            <Text color="red">{Icons.squareFilled}</Text>
            <Text dimColor> Down </Text>
            <Text color="#DC9300">{Icons.squareFilled}</Text>
            <Text dimColor> Degraded</Text>
          </Text>
        </Box>

        <ServiceHealthList
          health={MOCK_HEALTH}
          filterKeys={blockingKeys}
          showHealthy={false}
        />
      </Box>

      <Text dimColor>
        The wizard may not work reliably while services are affected.
      </Text>
    </ModalOverlay>
  );
};
