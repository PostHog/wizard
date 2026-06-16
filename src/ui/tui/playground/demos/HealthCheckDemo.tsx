/**
 * HealthCheckDemo — Playground demo for health check UI components.
 *
 * Cycles through three states (2s checking spinner → 5s confirmed-outage
 * red modal → 5s no-connection yellow modal, then loops):
 *   1. Checking (spinner)
 *   2. Confirmed outage (status page corroborates → red framing)
 *   3. No connection only (no status-page incident → yellow "couldn't
 *      reach PostHog" framing)
 *
 * Renders components directly (not HealthCheckScreen) to avoid useInput
 * conflicts with TabContainer's key handling.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { LoadingBox, ModalOverlay } from '@ui/tui/primitives/index';
import { Icons } from '@ui/tui/styles';
import { ServiceHealthList } from '@ui/tui/components/ServiceHealthList';
import { getBlockingServiceKeys } from '@lib/health-checks/readiness';
import { ServiceHealthStatus } from '@lib/health-checks/types';
import type { AllServicesHealth } from '@lib/health-checks/types';

const HEALTHY = { status: ServiceHealthStatus.Healthy } as const;

const MOCK_CONFIRMED_OUTAGE: AllServicesHealth = {
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
  githubReleases: HEALTHY,
};

const MOCK_NO_CONNECTION: AllServicesHealth = {
  anthropic: HEALTHY,
  posthogOverall: HEALTHY,
  posthogComponents: { status: ServiceHealthStatus.Healthy },
  github: HEALTHY,
  npmOverall: HEALTHY,
  npmComponents: { status: ServiceHealthStatus.Healthy },
  cloudflareOverall: HEALTHY,
  cloudflareComponents: { status: ServiceHealthStatus.Healthy },
  llmGateway: {
    status: ServiceHealthStatus.NoConnection,
    error: 'getaddrinfo ENOTFOUND gateway.us.posthog.com',
  },
  mcp: {
    status: ServiceHealthStatus.NoConnection,
    error: 'fetch failed',
  },
  githubReleases: HEALTHY,
};

type Phase = 'checking' | 'confirmed' | 'no-connection';

export const HealthCheckDemo = () => {
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('confirmed'), 2000);
    const t2 = setTimeout(() => setPhase('no-connection'), 7000);
    const t3 = setTimeout(() => setPhase('checking'), 12000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [phase]);

  if (phase === 'checking') {
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

  const health =
    phase === 'confirmed' ? MOCK_CONFIRMED_OUTAGE : MOCK_NO_CONNECTION;
  const blockingKeys = getBlockingServiceKeys(health);
  const isNoConnection = phase === 'no-connection';

  return (
    <ModalOverlay
      borderColor={isNoConnection ? 'yellow' : 'red'}
      title={
        isNoConnection
          ? "Couldn't reach PostHog"
          : `${Icons.warning} Ongoing service disruptions`
      }
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
            <Text dimColor> Degraded </Text>
            <Text color="gray">{Icons.squareFilled}</Text>
            <Text dimColor> No connection</Text>
          </Text>
        </Box>

        <ServiceHealthList
          health={health}
          filterKeys={blockingKeys}
          showHealthy={false}
        />
      </Box>

      <Text dimColor>
        {isNoConnection
          ? "We couldn't reach these services. PostHog's status page shows no incidents, likely a network issue (VPN, firewall, captive portal, or Wi-Fi)."
          : 'The wizard may not work reliably while services are affected.'}
      </Text>
    </ModalOverlay>
  );
};
