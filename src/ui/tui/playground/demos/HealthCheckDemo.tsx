// Preview the skills health-check states without handling input.

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { LoadingBox, ModalOverlay } from '@ui/tui/primitives/index';
import { Icons } from '@ui/tui/styles';
import { ServiceHealthList } from '@ui/tui/components/ServiceHealthList';
import { getBlockingServiceKeys } from '@lib/health-checks/readiness';
import { ServiceHealthStatus } from '@lib/health-checks/types';
import type { AllServicesHealth } from '@lib/health-checks/types';

const MOCK_CONFIRMED_OUTAGE: AllServicesHealth = {
  skillsOrigin: { status: ServiceHealthStatus.Down },
};

const MOCK_NO_CONNECTION: AllServicesHealth = {
  skillsOrigin: { status: ServiceHealthStatus.NoConnection },
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
          ? "Couldn't reach skill downloads"
          : `${Icons.warning} Skill downloads unavailable`
      }
      width={72}
      footer={
        <Box marginLeft={2}>
          <Text dimColor>Exit [Esc] (disabled in playground)</Text>
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
          ? "We couldn't reach either skills source. Check your connection and try again."
          : 'Neither GitHub Releases nor the AWS mirror is available.'}
      </Text>
    </ModalOverlay>
  );
};
