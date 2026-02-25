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

  const { pendingPrompt, completedPrompts } = store;

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <IntroView store={store} />

      <CompletedPrompts prompts={completedPrompts} />

      {pendingPrompt && (
        <PromptRenderer
          prompt={pendingPrompt}
          store={store}
          marginTop={completedPrompts.length > 0 ? 1 : 0}
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
