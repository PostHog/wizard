/**
 * OutageScreen — Shown when Claude/Anthropic services are degraded.
 * Displays the outage notice and a ConfirmationInput to continue or exit.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';

interface OutageScreenProps {
  store: WizardStore;
}

export const OutageScreen = ({ store }: OutageScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { serviceStatus } = store;

  if (!serviceStatus) {
    return null;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow" bold>
          {'\u26A0'} Claude/Anthropic services are experiencing issues.
        </Text>
        <Text> </Text>
        <Text>
          <Text color="yellow">Status:</Text> {serviceStatus.description}
        </Text>
        <Text>
          <Text color="yellow">Status page:</Text>{' '}
          <Text color="cyan">{serviceStatus.statusPageUrl}</Text>
        </Text>
        <Text> </Text>
        <Text dimColor>
          The wizard may not work reliably while services are affected.
        </Text>
      </Box>

      <ConfirmationInput
        message="Continue anyway?"
        onConfirm={() => store.popScreen()}
        onCancel={() => process.exit(0)}
      />
    </Box>
  );
};
