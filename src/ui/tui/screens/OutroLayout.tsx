/**
 * OutroLayout — Renders the success / error / cancel views shared by all
 * post-run screens. Wrapper screens supply the store and may inject extra
 * content into the success view's `extraSection` slot (e.g. a workflow's
 * own summary block).
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { Colors } from '../styles.js';

interface OutroLayoutProps {
  store: WizardStore;
  /** Rendered inside the success view, between the event-plan block and the
   *  docsUrl. Use for workflow-specific summary content. */
  extraSection?: ReactNode;
}

export const OutroLayout = ({ store, extraSection }: OutroLayoutProps) => {
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
            {'✔'} {outroData.message || 'Done!'}
          </Text>

          {outroData.body && (
            <Box marginTop={1}>
              <Text dimColor>{outroData.body}</Text>
            </Box>
          )}

          {outroData.reportFile && (
            <Box marginTop={1}>
              <Text>
                Check <Text bold>./{outroData.reportFile}</Text> for details
              </Text>
            </Box>
          )}

          {outroData.changes && outroData.changes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                What the agent did:
              </Text>
              {outroData.changes.map((change, i) => (
                <Text key={i}>
                  {'•'} {change}
                </Text>
              ))}
            </Box>
          )}

          {store.eventPlan.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                Events added:
              </Text>
              {store.eventPlan.map((event) => (
                <Text key={event.name}>
                  {'•'} <Text bold>{event.name}</Text>
                  <Text dimColor> {event.description}</Text>
                </Text>
              ))}
            </Box>
          )}

          {extraSection}

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
            {'✘'} {outroData.message || 'An error occurred'}
          </Text>

          {outroData.body && (
            <Box marginTop={1}>
              <Text dimColor>{outroData.body}</Text>
            </Box>
          )}

          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Docs: <Text color="cyan">{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}

      {outroData.kind === OutroKind.Cancel && (
        <Box flexDirection="column">
          <Text color="yellow">
            {'■'} {outroData.message || 'Cancelled'}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to continue</Text>
      </Box>
    </Box>
  );
};
