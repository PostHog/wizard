/**
 * Modal — Centered bordered overlay for interruption prompts.
 * Renders store.modalPrompt via PromptRenderer over any screen.
 */

import { Box, Text } from 'ink';
import type { WizardStore } from '../store.js';
import { PromptRenderer } from './PromptRenderer.js';

interface ModalProps {
  store: WizardStore;
}

export const Modal = ({ store }: ModalProps) => {
  if (!store.modalPrompt) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="yellow">
        {'\u26A0'} Attention
      </Text>
      <Box marginTop={1}>
        <PromptRenderer prompt={store.modalPrompt} store={store} />
      </Box>
    </Box>
  );
};
