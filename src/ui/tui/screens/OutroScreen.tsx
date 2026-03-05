/**
 * OutroScreen — Summary after the agent run.
 * Reads store.session.outroData to render success, error, or cancel view.
 * Keeps the process alive until the user presses a key to exit.
 */

import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { Colors } from '../styles.js';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useInput(() => {
    process.exit(0);
  });

  const outroData = store.session.outroData;

  if (!outroData) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text dimColor>Finishing up...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          <Text color="green" bold>
            {'\u2714'} Successfully installed PostHog!
          </Text>

          <Box marginTop={1}>
            <Text>
              Check <Text bold>posthog-setup-report.md</Text> for details about
              your integration
            </Text>
          </Box>

          {outroData.changes && outroData.changes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                What the agent did:
              </Text>
              {outroData.changes.map((change, i) => (
                <Text key={i}>
                  {'\u2022'} {change}
                </Text>
              ))}
            </Box>
          )}

          {outroData.nextSteps && outroData.nextSteps.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow" bold>
                Next steps:
              </Text>
              {outroData.nextSteps.map((step, i) => (
                <Text key={i}>
                  {'\u2022'} {step}
                </Text>
              ))}
            </Box>
          )}

          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Learn more: <Text color="cyan">{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}

          {outroData.continueUrl && (
            <Box>
              <Text>
                Continue onboarding:{' '}
                <Text color="cyan">{outroData.continueUrl}</Text>
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Note: This wizard uses an LLM agent to analyze and modify your
              project. Please review the changes made.
            </Text>
          </Box>
          <Box>
            <Text dimColor>
              How did this work for you? Drop us a line: wizard@posthog.com
            </Text>
          </Box>
        </Box>
      )}

      {outroData.kind === OutroKind.Error && (
        <Box flexDirection="column">
          <Text color="red" bold>
            {'\u2718'} {outroData.message || 'An error occurred'}
          </Text>
        </Box>
      )}

      {outroData.kind === OutroKind.Cancel && (
        <Box flexDirection="column">
          <Text color="yellow">
            {'\u25A0'} {outroData.message || 'Cancelled'}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to exit</Text>
      </Box>
    </Box>
  );
};
