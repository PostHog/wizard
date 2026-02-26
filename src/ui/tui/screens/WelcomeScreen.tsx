/**
 * WelcomeScreen — Full-pane intro + prompts, no tabs.
 * Handles all pre-agent prompts (cloud region, login, framework picker).
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { IntroView } from '../components/IntroView.js';
import { CompletedPrompts } from '../components/CompletedPrompts.js';
import { PromptRenderer } from '../components/PromptRenderer.js';

interface WelcomeScreenProps {
  store: WizardStore;
}

export const WelcomeScreen = ({ store }: WelcomeScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { pendingPrompt, completedPrompts, loginUrl } = store;

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <IntroView store={store} />

      <CompletedPrompts prompts={completedPrompts} />

      {loginUrl && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            If the browser didn't open automatically, use this link:
          </Text>
          <Text color="cyan">{loginUrl}</Text>
        </Box>
      )}

      {pendingPrompt && (
        <PromptRenderer
          prompt={pendingPrompt}
          store={store}
          marginTop={completedPrompts.length > 0 || loginUrl ? 1 : 0}
        />
      )}

      {/* Empty state — before any intro data arrives */}
      {!pendingPrompt &&
        completedPrompts.length === 0 &&
        !store.wizardLabel &&
        !store.detectedFramework && <Text dimColor>Starting...</Text>}
    </Box>
  );
};
