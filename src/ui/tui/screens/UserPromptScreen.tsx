/**
 * UserPromptScreen — Modal driven by the prompt_user MCP tool.
 *
 * Renders a PickerMenu (single/multi) or a TextInput depending on the
 * mode the agent passed. On selection/submit, calls store.resolveUserPrompt
 * which pops the overlay and unblocks the awaiting MCP tool call.
 */

import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ModalOverlay, PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';

interface UserPromptScreenProps {
  store: WizardStore;
}

export const UserPromptScreen = ({ store }: UserPromptScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const data = store.session.userPromptData;
  if (!data) return null;

  return (
    <ModalOverlay borderColor={Colors.accent} title={data.title} width={72}>
      <Box flexDirection="column" gap={1}>
        <Text>{data.message}</Text>

        {data.mode === 'text' ? (
          <Box>
            <TextInput
              placeholder={data.placeholder ?? ''}
              onSubmit={(value: string) => store.resolveUserPrompt(value)}
            />
          </Box>
        ) : (
          <PickerMenu
            options={data.options ?? []}
            mode={data.mode}
            onSelect={(value: string | string[]) =>
              store.resolveUserPrompt(value)
            }
          />
        )}
      </Box>
    </ModalOverlay>
  );
};
