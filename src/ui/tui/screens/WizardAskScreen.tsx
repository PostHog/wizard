/**
 * WizardAskScreen — Overlay for the `wizard_ask` MCP tool.
 *
 * Walks the agent's question list one at a time and accumulates answers.
 * When the user submits the last question, the store resolves the
 * pending request and the overlay pops, returning the agent to its run.
 */

import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ModalOverlay, PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import type { AskAnswers, AskQuestion } from '../../../lib/wizard-session.js';

interface WizardAskScreenProps {
  store: WizardStore;
}

export const WizardAskScreen = ({ store }: WizardAskScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const pending = store.session.pendingQuestion;

  // Index of the question currently being answered. Resets when a fresh
  // pending request arrives.
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AskAnswers>({});
  const [lastPendingId, setLastPendingId] = useState<string | null>(null);

  if (!pending) return null;

  // Reset accumulator state when the agent opens a new request mid-session.
  if (pending.id !== lastPendingId) {
    setLastPendingId(pending.id);
    setIndex(0);
    setAnswers({});
    return null;
  }

  const question = pending.questions[index];
  if (!question) return null;

  const total = pending.questions.length;
  const progress = total > 1 ? `Question ${index + 1} of ${total}` : null;

  const submit = (value: string | string[]) => {
    const next: AskAnswers = { ...answers, [question.id]: value };
    if (index + 1 < total) {
      setAnswers(next);
      setIndex(index + 1);
      return;
    }
    store.resolvePendingQuestion(next);
  };

  return (
    <ModalOverlay
      borderColor={Colors.accent}
      title={`${Icons.diamond} ${pending.source}`}
      titleColor={Colors.accent}
      width={72}
    >
      {progress && (
        <Box marginBottom={1}>
          <Text dimColor>{progress}</Text>
        </Box>
      )}
      <Box flexDirection="column">
        <Text>{question.prompt}</Text>
      </Box>
      <Box marginTop={1}>
        <QuestionInput question={question} onSubmit={submit} />
      </Box>
    </ModalOverlay>
  );
};

interface QuestionInputProps {
  question: AskQuestion;
  onSubmit: (value: string | string[]) => void;
}

const QuestionInput = ({ question, onSubmit }: QuestionInputProps) => {
  switch (question.kind) {
    case 'single':
      return (
        <PickerMenu<string>
          options={(question.options ?? []).map((o) => ({
            label: o.label,
            value: o.value,
          }))}
          onSelect={(value) => {
            const v = Array.isArray(value) ? value[0] : value;
            onSubmit(v);
          }}
        />
      );

    case 'multi':
      return (
        <PickerMenu<string>
          mode="multi"
          options={(question.options ?? []).map((o) => ({
            label: o.label,
            value: o.value,
          }))}
          onSelect={(value) => {
            const v = Array.isArray(value) ? value : [value];
            onSubmit(v);
          }}
        />
      );

    case 'text':
      return (
        <TextInput
          placeholder="Type your answer and press enter"
          onSubmit={(value) => onSubmit(value)}
        />
      );
  }
};
