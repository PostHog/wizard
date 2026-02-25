import { Box, Text } from 'ink';
import { MultiSelect } from '@inkjs/ui';
import type { PendingPrompt, WizardStore } from '../store.js';

interface MultiselectPromptProps {
  prompt: PendingPrompt;
  store: WizardStore;
}

/**
 * Handles both 'multiselect' and 'groupMultiselect' prompt types.
 * For groupMultiselect, options are flattened into a single list.
 */
export const MultiselectPrompt = ({
  prompt,
  store,
}: MultiselectPromptProps) => {
  // Flatten group options if this is a groupMultiselect
  const rawOptions =
    prompt.type === 'groupMultiselect' && prompt.groupOptions
      ? Object.values(prompt.groupOptions).flat()
      : prompt.options ?? [];

  const options = rawOptions.map((opt, i) => ({
    label: opt.hint ? `${opt.label} (${opt.hint})` : opt.label,
    value: String(i),
  }));

  // Map initialValues to their indices
  const defaultValue =
    prompt.initialValues != null
      ? rawOptions
          .map((opt, i) => ({ opt, i }))
          .filter(({ opt }) =>
            (prompt.initialValues as unknown[])?.includes(opt.value),
          )
          .map(({ i }) => String(i))
      : undefined;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {'\u25C6'} {prompt.message}
      </Text>
      <Text dimColor> (space to toggle, enter to submit)</Text>
      <Box marginLeft={2}>
        <MultiSelect
          options={options}
          defaultValue={defaultValue}
          onSubmit={(selectedIndices) => {
            const values = selectedIndices.map((idx) => {
              const i = parseInt(idx, 10);
              return rawOptions[i]?.value;
            });
            const labels = selectedIndices.map((idx) => {
              const i = parseInt(idx, 10);
              return rawOptions[i]?.label ?? '';
            });
            store.addCompletedPrompt({
              message: prompt.message,
              answer: labels.join(', '),
            });
            prompt.resolve(values);
            store.setPendingPrompt(null);
          }}
        />
      </Box>
    </Box>
  );
};
