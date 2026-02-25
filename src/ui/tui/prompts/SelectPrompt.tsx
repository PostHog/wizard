import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import type { PendingPrompt, WizardStore } from '../store.js';

interface SelectPromptProps {
  prompt: PendingPrompt;
  store: WizardStore;
}

export const SelectPrompt = ({ prompt, store }: SelectPromptProps) => {
  const options = (prompt.options ?? []).map((opt, i) => ({
    label: opt.hint ? `${opt.label} (${opt.hint})` : opt.label,
    value: String(i),
  }));

  const defaultIndex =
    prompt.initialValue != null
      ? (prompt.options ?? []).findIndex((o) => o.value === prompt.initialValue)
      : -1;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {'\u25C6'} {prompt.message}
      </Text>
      <Box marginLeft={2}>
        <Select
          options={options}
          defaultValue={defaultIndex >= 0 ? String(defaultIndex) : undefined}
          visibleOptionCount={prompt.maxItems ?? 8}
          onChange={(value) => {
            const idx = parseInt(value, 10);
            const selected = (prompt.options ?? [])[idx];
            if (selected) {
              store.addCompletedPrompt({
                message: prompt.message,
                answer: selected.label,
              });
              prompt.resolve(selected.value);
              store.setPendingPrompt(null);
            }
          }}
        />
      </Box>
    </Box>
  );
};
