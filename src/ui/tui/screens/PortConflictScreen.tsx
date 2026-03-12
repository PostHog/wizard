/**
 * PortConflictScreen — Modal when another process is blocking the OAuth port.
 *
 * Offers to kill the blocking process and retry, or exit.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import { execSync } from 'node:child_process';
import type { WizardStore } from '../store.js';
import { ConfirmationInput, ModalOverlay } from '../primitives/index.js';
import { OAUTH_PORT } from '../../../lib/constants.js';

interface PortConflictScreenProps {
  store: WizardStore;
}

export const PortConflictScreen = ({ store }: PortConflictScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [feedback, setFeedback] = useState<string | null>(null);
  const processInfo = store.session.portConflictProcess;

  if (!processInfo) return null;

  return (
    <ModalOverlay
      borderColor="#DC9300"
      title={`Port ${OAUTH_PORT} in use`}
      width={72}
      feedback={feedback}
      footer={
        <ConfirmationInput
          message="Kill process and continue?"
          confirmLabel="Kill & continue [Enter]"
          cancelLabel="Exit [Esc]"
          onConfirm={() => {
            try {
              execSync(`lsof -ti :${OAUTH_PORT} | xargs kill`, {
                stdio: 'ignore',
              });
              store.resolvePortConflict();
            } catch {
              setFeedback(
                `Could not kill the process. Try running: lsof -ti :${OAUTH_PORT} | xargs kill`,
              );
            }
          }}
          onCancel={() => process.exit(1)}
        />
      }
    >
      <Text>Another process is blocking the authentication server:</Text>
      <Box flexDirection="column" marginY={1} paddingLeft={2} gap={0}>
        <Text>
          <Text dimColor>Command </Text>
          <Text bold>{processInfo.command}</Text>
        </Text>
        <Text>
          <Text dimColor>PID </Text>
          <Text bold>{processInfo.pid}</Text>
        </Text>
        <Text>
          <Text dimColor>User </Text>
          <Text bold>{processInfo.user}</Text>
        </Text>
      </Box>
      <Text dimColor>
        Kill this process to continue, or exit and free the port manually.
      </Text>
    </ModalOverlay>
  );
};
