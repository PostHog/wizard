/**
 * McpScreen — Stub for MCP-specific flow.
 * Renders prompts in a simple full-pane layout.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { CompletedPrompts } from '../components/CompletedPrompts.js';
import { PromptRenderer } from '../components/PromptRenderer.js';

interface McpScreenProps {
  store: WizardStore;
}

export const McpScreen = ({ store }: McpScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { pendingPrompt, completedPrompts } = store;

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Text bold color="yellow">
        MCP Server Setup
      </Text>

      <CompletedPrompts prompts={completedPrompts} />

      {pendingPrompt && (
        <PromptRenderer
          prompt={pendingPrompt}
          store={store}
          marginTop={completedPrompts.length > 0 ? 1 : 0}
        />
      )}
    </Box>
  );
};
