/**
 * OutroScreen — Default post-run summary.
 *
 * Renders the success / error / cancel views from `outroData`. Programs
 * that need a different success view (e.g. with extra summary content)
 * ship their own screen component (see audit/AuditOutroScreen.tsx).
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { OutroKind } from '@lib/wizard-session';
import { Colors } from '@ui/tui/styles';
import { withUtm } from '@utils/links';
import { useDismissOnAnyKey } from '@ui/tui/hooks/useDismissOnAnyKey';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // Dismissal here chains into ExitScreen's process.exit(), so a modifier
  // combo (e.g. Ctrl+T toggling the token/cost HUD) must not trigger it too.
  useDismissOnAnyKey(() => store.setOutroDismissed());

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
            ✔ {outroData.message || 'Done!'}
          </Text>

          {outroData.primaryLink && (
            <Box marginTop={1}>
              <Text>
                {outroData.primaryLink.label}:{' '}
                <Text color="cyan">{outroData.primaryLink.url}</Text>
              </Text>
            </Box>
          )}

          {outroData.nextSteps && outroData.nextSteps.items.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                {outroData.nextSteps.heading}
              </Text>
              {outroData.nextSteps.items.map((item, i) => (
                <Text key={i}>• {item}</Text>
              ))}
            </Box>
          )}

          {outroData.dashboardUrl && (
            <Box marginTop={1}>
              <Text>
                Dashboard:{' '}
                <Text color="cyan">
                  {withUtm(outroData.dashboardUrl, 'outro-dashboard')}
                </Text>
              </Text>
            </Box>
          )}

          {outroData.notebookUrl && (
            <Box marginTop={1}>
              <Text>
                Notebook:{' '}
                <Text color="cyan">
                  {withUtm(outroData.notebookUrl, 'outro-notebook')}
                </Text>
              </Text>
            </Box>
          )}

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
                <Text key={i}>• {change}</Text>
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
                  • <Text bold>{event.name}</Text>
                  <Text dimColor> {event.description}</Text>
                </Text>
              ))}
            </Box>
          )}

          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Learn more:{' '}
                <Text color="cyan">
                  {withUtm(outroData.docsUrl, 'outro-docs')}
                </Text>
              </Text>
            </Box>
          )}

          {outroData.continueUrl && (
            <Box>
              <Text>
                Continue onboarding:{' '}
                <Text color="cyan">
                  {withUtm(outroData.continueUrl, 'outro-continue')}
                </Text>
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Note: This wizard uses an LLM agent to analyze and modify your
              project. Please review the changes made.
            </Text>
          </Box>
          <Text dimColor>
            How did this work for you? Drop us a line: wizard@posthog.com
          </Text>
        </Box>
      )}

      {outroData.kind === OutroKind.Error && (
        <Box flexDirection="column">
          <Text color="red" bold>
            ✘ {outroData.message || 'An error occurred'}
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
          <Text color="yellow">■ {outroData.message || 'Cancelled'}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to continue</Text>
      </Box>
    </Box>
  );
};
