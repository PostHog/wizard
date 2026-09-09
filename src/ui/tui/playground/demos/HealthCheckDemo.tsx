/**
 * HealthCheckDemo — checking, gateway outage, and unavailable skill downloads.
 * Renders components directly to avoid conflicts with TabContainer input.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { LoadingBox, ModalOverlay } from '@ui/tui/primitives/index';
import { ServiceHealthList } from '@ui/tui/components/ServiceHealthList';
import { getBlockingServiceKeys } from '@lib/health-checks/readiness';
import {
  ServiceHealthStatus,
  type AllServicesHealth,
} from '@lib/health-checks/types';

const MOCK_GATEWAY_OUTAGE: AllServicesHealth = {
  llmGateway: { status: ServiceHealthStatus.Down, error: 'HTTP 503' },
  skillsOrigin: { status: ServiceHealthStatus.Healthy },
};

const MOCK_SKILLS_UNAVAILABLE: AllServicesHealth = {
  skillsOrigin: {
    status: ServiceHealthStatus.NoConnection,
    error: 'No configured skills source is reachable',
  },
};

type Phase = 'checking' | 'gateway' | 'skills';

export const HealthCheckDemo = () => {
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    const timer = setTimeout(
      () =>
        setPhase(
          phase === 'checking'
            ? 'gateway'
            : phase === 'gateway'
            ? 'skills'
            : 'checking',
        ),
      phase === 'checking' ? 2000 : 5000,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'checking') {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <LoadingBox message="Checking skill downloads..." />
      </Box>
    );
  }

  const skillsUnavailable = phase === 'skills';
  const health = skillsUnavailable
    ? MOCK_SKILLS_UNAVAILABLE
    : MOCK_GATEWAY_OUTAGE;
  const blockingKeys = getBlockingServiceKeys(health);
  const allNoConnection = blockingKeys.every(
    (key) => health[key]?.status === ServiceHealthStatus.NoConnection,
  );

  return (
    <ModalOverlay
      borderColor={allNoConnection ? 'yellow' : 'red'}
      title={
        skillsUnavailable
          ? 'Could not connect to skill downloads'
          : 'AI gateway unavailable'
      }
      width={72}
      footer={
        <Box marginLeft={2}>
          <Text dimColor>
            {skillsUnavailable ? 'Exit [Esc]' : 'Continue [Enter] / Exit [Esc]'}{' '}
            (disabled in playground)
          </Text>
        </Box>
      }
    >
      <Box flexDirection="column" marginBottom={1}>
        <ServiceHealthList
          health={health}
          filterKeys={blockingKeys}
          showHealthy={false}
        />
      </Box>
      <Text dimColor>
        {skillsUnavailable
          ? 'The Wizard could not download the skills it needs from any configured source. Check your connection and try again.'
          : 'The PostHog AI gateway is currently unavailable. You can try continuing, or exit and try again later.'}
      </Text>
    </ModalOverlay>
  );
};
