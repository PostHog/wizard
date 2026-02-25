/**
 * CompletedPrompts — Scrolling list of answered prompts with checkmarks.
 * Extracted from StatusTab for reuse across screens.
 */

import { Text } from 'ink';
import type { CompletedPrompt } from '../store.js';

interface CompletedPromptsProps {
  prompts: CompletedPrompt[];
}

export const CompletedPrompts = ({ prompts }: CompletedPromptsProps) => {
  if (prompts.length === 0) return null;

  return (
    <>
      {prompts.map((cp, i) => (
        <Text key={i} dimColor>
          <Text color="green">{'\u2714'}</Text>
          {'  '}
          <Text>{cp.message}</Text>
          <Text color="gray">
            {' '}
            {'\u2192'} {cp.answer}
          </Text>
        </Text>
      ))}
    </>
  );
};
