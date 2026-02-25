import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useState } from 'react';
import type { PendingPrompt, WizardStore } from '../store.js';

interface TextPromptProps {
  prompt: PendingPrompt;
  store: WizardStore;
}

export const TextPrompt = ({ prompt, store }: TextPromptProps) => {
  const [error, setError] = useState<string | undefined>();

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {'\u25C6'} {prompt.message}
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <TextInput
          placeholder={prompt.placeholder}
          onSubmit={(value) => {
            if (prompt.validate) {
              const err = prompt.validate(value);
              if (err) {
                setError(err);
                return;
              }
            }
            setError(undefined);
            store.addCompletedPrompt({
              message: prompt.message,
              answer: value,
            });
            prompt.resolve(value);
            store.setPendingPrompt(null);
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    </Box>
  );
};
