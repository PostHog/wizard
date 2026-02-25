import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';

interface StatusPanelProps {
  store: WizardStore;
}

export const StatusPanel = ({ store }: StatusPanelProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const messages = store.statusMessages;
  const current = messages[messages.length - 1];

  if (!current) {
    return null;
  }

  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
      paddingX={1}
      overflow="hidden"
    >
      <Text>
        <Text color="cyan">{'\u25C7'}</Text>
        <Text> {current}</Text>
      </Text>
    </Box>
  );
};
