/**
 * HealthWarningsTab — Non-blocking health warnings shown as a tab in RunScreen.
 *
 * Displays all services with their status: healthy (green), degraded (yellow), down (red).
 */

import { Box, Text } from 'ink';
import type { WizardStore } from '../../store.js';
import { Icons } from '../../styles.js';
import { ServiceHealthList } from '../../components/ServiceHealthList.js';

interface HealthWarningsTabProps {
  store: WizardStore;
}

export const HealthWarningsTab = ({ store }: HealthWarningsTabProps) => {
  const result = store.session.readinessResult;
  if (!result) return null;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="#DC9300">
        {Icons.warning} Service warnings
      </Text>
      <Box height={1} />

      <Box marginBottom={1}>
        <Text>
          <Text color="green">{Icons.check}</Text>
          <Text dimColor> Healthy </Text>
          <Text color="#DC9300">{Icons.squareFilled}</Text>
          <Text dimColor> Degraded </Text>
          <Text color="red">{Icons.squareFilled}</Text>
          <Text dimColor> Down</Text>
        </Text>
      </Box>

      <ServiceHealthList health={result.health} showHealthy={true} />
    </Box>
  );
};
