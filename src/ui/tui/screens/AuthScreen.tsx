/**
 * AuthScreen — Shown while waiting for OAuth authentication.
 *
 * Displays a waiting spinner and the login URL when available.
 * The router resolves past this screen once session.credentials is set.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Colors } from '../styles.js';

interface AuthScreenProps {
  store: WizardStore;
}

const SPINNER_FRAMES = [
  '\u28CB',
  '\u28D9',
  '\u28F9',
  '\u28F8',
  '\u28FC',
  '\u28F4',
  '\u28E6',
  '\u28E7',
  '\u28C7',
  '\u28CF',
];

export const AuthScreen = ({ store }: AuthScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  const region = store.session.cloudRegion ?? 'us';
  const regionLabel = region === 'eu' ? 'EU Cloud' : 'US Cloud';
  const loginUrl = store.session.loginUrl;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Authentication
        </Text>
        <Text dimColor>Region: {regionLabel}</Text>
      </Box>

      <Box>
        <Text color={Colors.accent}>{SPINNER_FRAMES[frame]} </Text>
        <Text>Waiting for authentication...</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          A browser window should open for you to log in to PostHog.
        </Text>
        {loginUrl && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              If it didn't open, copy and paste this URL into your browser:
            </Text>
            <Text color="cyan">{loginUrl}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
