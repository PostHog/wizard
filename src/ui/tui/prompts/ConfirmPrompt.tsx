import { Box, Text } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import type { PendingPrompt, WizardStore } from '../store.js';

interface ConfirmPromptProps {
  prompt: PendingPrompt;
  store: WizardStore;
}

export const ConfirmPrompt = ({ prompt, store }: ConfirmPromptProps) => {
  const defaultChoice = prompt.initialValue === false ? 'cancel' : 'confirm';

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {'\u25C6'} {prompt.message}
      </Text>
      <Box marginLeft={2}>
        <ConfirmInput
          defaultChoice={defaultChoice}
          onConfirm={() => {
            store.addCompletedPrompt({
              message: prompt.message,
              answer: 'Yes',
            });
            prompt.resolve(true);
            store.setPendingPrompt(null);
          }}
          onCancel={() => {
            store.addCompletedPrompt({
              message: prompt.message,
              answer: 'No',
            });
            prompt.resolve(false);
            store.setPendingPrompt(null);
          }}
        />
      </Box>
    </Box>
  );
};
