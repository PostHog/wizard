/**
 * StatusScreen — Shown when Claude/Anthropic services are degraded.
 * Displays the outage notice and a confirm prompt to continue.
 * Skipped entirely when services are operational.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PromptRenderer } from '../components/PromptRenderer.js';

interface StatusScreenProps {
  store: WizardStore;
}

export const StatusScreen = ({ store }: StatusScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { serviceStatus, pendingPrompt } = store;

  if (!serviceStatus) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
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

      {pendingPrompt && <PromptRenderer prompt={pendingPrompt} store={store} />}
    </Box>
  );
};
