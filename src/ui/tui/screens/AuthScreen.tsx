/**
 * AuthScreen — Shown while waiting for OAuth authentication.
 *
 * Displays framework detection results, beta/disclosure notices,
 * a waiting spinner, and the login URL when available.
 * The router resolves past this screen once session.credentials is set.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { LoadingBox } from '../primitives/index.js';
import { Colors } from '../styles.js';

interface AuthScreenProps {
  store: WizardStore;
}

export const AuthScreen = ({ store }: AuthScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const config = session.frameworkConfig;
  const regionLabel = session.cloudRegion === 'eu' ? 'EU Cloud' : 'US Cloud';
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          PostHog Setup Wizard
        </Text>

        {frameworkLabel && (
          <Text>
            <Text color="green">{'\u2714'} </Text>
            <Text>Detected: {frameworkLabel}</Text>
          </Text>
        )}

        <Text dimColor>Region: {regionLabel}</Text>

        {config?.metadata.beta && (
          <Text color="yellow">
            [BETA] The {config.metadata.name} wizard is in beta. Questions or
            feedback? Email wizard@posthog.com
          </Text>
        )}

        {config?.metadata.preRunNotice && (
          <Text color="yellow">{config.metadata.preRunNotice}</Text>
        )}
      </Box>

      <LoadingBox message="Waiting for authentication..." />

      {session.loginUrl && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            If the browser didn't open, copy and paste this URL:
          </Text>
          <Text color="cyan">{session.loginUrl}</Text>
        </Box>
      )}
    </Box>
  );
};
