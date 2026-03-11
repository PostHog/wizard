/**
 * HealthCheckScreen — Flow screen between Intro and Auth.
 *
 * Three states:
 *   1. Checking: spinner while health check runs
 *   2. Healthy: isComplete returns true, router auto-advances to Auth
 *   3. Blocking outage: shows affected services with Continue/Exit
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import {
  ConfirmationInput,
  LoadingBox,
  ModalOverlay,
} from '../../primitives/index.js';
import { Icons } from '../../styles.js';
import {
  ServiceHealthList,
  getBlockingServiceKeys,
} from '../../components/ServiceHealthList.js';
import { wizardAbort } from '../../../../utils/wizard-abort.js';

interface HealthCheckScreenProps {
  store: WizardStore;
}

export const HealthCheckScreen = ({ store }: HealthCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const result = store.session.readinessResult;

  // Still checking — show spinner
  if (!result) {
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

  // Healthy or warnings — isComplete returns true, router skips past.
  // This branch only renders for a single frame before advancing.
  const blockingKeys = getBlockingServiceKeys(result.health);
  if (blockingKeys.length === 0) return null;

  // Blocking outage — show service list with Continue/Exit
  return (
    <ModalOverlay
      borderColor="red"
      title={`${Icons.warning} Ongoing service disruptions`}
      width={72}
      footer={
        <ConfirmationInput
          message="Continue anyway?"
          confirmLabel="Continue [Enter]"
          cancelLabel="Exit [Esc]"
          onConfirm={() => store.dismissOutage()}
          onCancel={() =>
            void wizardAbort({ message: 'Exited due to service outage.' })
          }
        />
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
          health={result.health}
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
