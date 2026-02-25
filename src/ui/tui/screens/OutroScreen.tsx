/**
 * OutroScreen — Full-pane summary after the agent run.
 * Reads store.outroData to render success, error, or cancel view.
 * Post-run opt-in prompts render here via PromptRenderer.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { CompletedPrompts } from '../components/CompletedPrompts.js';
import { PromptRenderer } from '../components/PromptRenderer.js';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { outroData, pendingPrompt, completedPrompts } = store;

  if (!outroData) {
    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <Text dimColor>Finishing up...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {outroData.kind === 'success' && (
        <Box flexDirection="column">
          <Text color="green" bold>
            {'\u2714'} Successfully installed PostHog!
          </Text>

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

      {outroData.kind === 'error' && (
        <Box flexDirection="column">
          <Text color="red" bold>
            {'\u2718'} {outroData.message || 'An error occurred'}
          </Text>
        </Box>
      )}

      {outroData.kind === 'cancel' && (
        <Box flexDirection="column">
          <Text color="yellow">
            {'\u25A0'} {outroData.message || 'Cancelled'}
          </Text>
        </Box>
      )}

      {/* Post-run completed prompts (env upload, MCP install) */}
      {completedPrompts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <CompletedPrompts prompts={completedPrompts} />
        </Box>
      )}

      {/* Post-run active prompt */}
      {pendingPrompt && (
        <PromptRenderer prompt={pendingPrompt} store={store} marginTop={1} />
      )}
    </Box>
  );
};
