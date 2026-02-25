/**
 * PromptRenderer — Dispatches the active prompt to the appropriate component.
 * Extracted from StatusTab for reuse across screens.
 */

import { Box } from 'ink';
import type { WizardStore, PendingPrompt } from '../store.js';
import { SelectPrompt } from '../prompts/SelectPrompt.js';
import { ConfirmPrompt } from '../prompts/ConfirmPrompt.js';
import { TextPrompt } from '../prompts/TextPrompt.js';
import { MultiselectPrompt } from '../prompts/MultiselectPrompt.js';

interface PromptRendererProps {
  prompt: PendingPrompt;
  store: WizardStore;
  marginTop?: number;
}

export const PromptRenderer = ({
  prompt,
  store,
  marginTop = 0,
}: PromptRendererProps) => {
  return (
    <Box marginTop={marginTop}>
      {prompt.type === 'select' && (
        <SelectPrompt prompt={prompt} store={store} />
      )}
      {prompt.type === 'confirm' && (
        <ConfirmPrompt prompt={prompt} store={store} />
      )}
      {prompt.type === 'text' && <TextPrompt prompt={prompt} store={store} />}
      {(prompt.type === 'multiselect' ||
        prompt.type === 'groupMultiselect') && (
        <MultiselectPrompt prompt={prompt} store={store} />
      )}
    </Box>
  );
};
