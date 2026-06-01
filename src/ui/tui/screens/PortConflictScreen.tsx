/**
 * PortConflictScreen — Modal when all OAuth port candidates are occupied.
 *
 * Shows every port the wizard tried and asks the user to free them manually.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { OAUTH_PORTS } from '@lib/constants';
import { ConfirmationInput, ModalOverlay } from '@ui/tui/primitives/index';

interface PortConflictScreenProps {
  store: WizardStore;
}

export const PortConflictScreen = ({ store }: PortConflictScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const processInfo = store.session.portConflictProcess;

  if (!processInfo) return null;

  return (
    <ModalOverlay
      borderColor="#DC9300"
      title="OAuth ports in use"
      width={72}
      footer={
        <ConfirmationInput
          message="Retry after freeing ports?"
          confirmLabel="Retry [Enter]"
          cancelLabel="Exit [Esc]"
          onConfirm={() => store.resolvePortConflict()}
          onCancel={() => process.exit(1)}
        />
      }
    >
      <Text>
        The wizard needs a local port for OAuth. We tried these ports which are
        all in use:
      </Text>
      <Box flexDirection="column" marginY={1} paddingLeft={2} gap={0}>
        {OAUTH_PORTS.map((port) => (
          <Text key={port}>
            <Text dimColor>Port </Text>
            <Text bold>{port}</Text>
          </Text>
        ))}
      </Box>
      <Text dimColor>Please free one of these ports and retry.</Text>
    </ModalOverlay>
  );
};
