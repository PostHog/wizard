/**
 * Runtime prompt notes — markdown under `prompts/`, appended to the system
 * prompt by harness and by model. See `prompts/README.md` for how to add one.
 */

import {
  GPT5_4_MODEL,
  GPT5_MINI_MODEL,
  GPT5_MODEL,
  Harness,
} from '@lib/constants';
import piNotes from './prompts/pi.md';
import gpt5FamilyNotes from './prompts/models/openai-gpt-5-family.md';

const HARNESS_NOTES: Partial<Record<Harness, string>> = {
  [Harness.pi]: piNotes,
};

/** Gateway model id → note file. Multiple ids may share one file. */
const MODEL_NOTES: Record<string, string> = {
  [GPT5_MODEL]: gpt5FamilyNotes,
  [GPT5_4_MODEL]: gpt5FamilyNotes,
  [GPT5_MINI_MODEL]: gpt5FamilyNotes,
};

/** Notes appended to the system prompt for a `(harness, model)` pick. */
export function runtimeNotes(harness: Harness, model: string): string {
  return [HARNESS_NOTES[harness], MODEL_NOTES[model]]
    .filter(Boolean)
    .map((n) => (n as string).trim())
    .join('\n\n');
}
