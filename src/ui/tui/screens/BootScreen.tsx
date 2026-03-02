/**
 * BootScreen — Shown while detecting the project's framework.
 *
 * Displays a spinner while bin.ts runs detection + gatherContext.
 * The router resolves past this screen once session.frameworkConfig is set.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { LoadingBox } from '../primitives/index.js';
import { Colors } from '../styles.js';

interface BootScreenProps {
  store: WizardStore;
}

export const BootScreen = ({ store }: BootScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          PostHog Setup Wizard
        </Text>
      </Box>

      <LoadingBox message="Detecting project framework..." />
    </Box>
  );
};
