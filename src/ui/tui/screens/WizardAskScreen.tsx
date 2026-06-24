/**
 * WizardAskScreen — Overlay for the `wizard_ask` MCP tool.
 *
 * Walks the agent's question list one at a time and accumulates answers.
 * When the user submits the last question, the store resolves the
 * pending request and the overlay pops, returning the agent to its run.
 */

import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import {
  LinkText,
  ModalOverlay,
  PickerMenu,
  extractUrls,
} from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import { copyToClipboard } from '@utils/clipboard';
import type { AskAnswers, AskQuestion } from '@lib/wizard-session';

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
  const [copied, setCopied] = useState(false);

  // For rich-link prompts (opt-in programs only) copy a lone URL to the
  // clipboard, so users on terminals without OSC 8 support can still paste it.
  // Only fires when the current question has exactly one URL, to avoid
  // clobbering the clipboard ambiguously. `soleUrl` is the sole effect dep.
  const richLinks = pending?.richLinks ?? false;
  const currentPrompt = pending?.questions[index]?.prompt ?? '';
  const promptUrls = richLinks ? extractUrls(currentPrompt) : [];
  const soleUrl = promptUrls.length === 1 ? promptUrls[0] : null;

  useEffect(() => {
    setCopied(false);
    if (!soleUrl) return;
    let active = true;
    void copyToClipboard(soleUrl).then((ok) => {
      if (active && ok) setCopied(true);
    });
    return () => {
      active = false;
    };
  }, [soleUrl]);

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
        {pending.richLinks ? (
          <LinkText text={question.prompt} />
        ) : (
          <Text>{question.prompt}</Text>
        )}
      </Box>
      {pending.richLinks && copied && (
        <Box marginTop={1}>
          <Text dimColor>
            Link copied to clipboard — paste it in your browser if it isn&apos;t
            clickable.
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        {/* `key` forces React to remount the input when the question changes
            so per-question internal state (typed buffer, picker focus) doesn't
            bleed across questions. */}
        <QuestionInput
          key={`${pending.id}:${question.id}`}
          question={question}
          onSubmit={submit}
        />
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

    case 'multi': {
      const multiOptions = (question.options ?? []).map((o) => ({
        label: o.label,
        value: o.value,
        description: o.description,
      }));
      // Add vertical breathing room between options only when at least one
      // carries a description — keeps every description-less multi-select
      // (every other program) spaced exactly as before.
      const hasDescriptions = multiOptions.some((o) => o.description);
      return (
        <PickerMenu<string>
          mode="multi"
          optionMarginBottom={hasDescriptions ? 1 : 0}
          options={multiOptions}
          onSelect={(value) => {
            const v = Array.isArray(value) ? value : [value];
            onSubmit(v);
          }}
        />
      );
    }

    case 'text':
      return (
        // `width="100%"` on both the column and the hint row anchors them to
        // the modal's content width — without it, Ink/Yoga shrinks the column
        // to fit its widest child, so the right-aligned hint walks left/right
        // as the typed text changes width.
        <Box flexDirection="column" width="100%">
          <TextInput
            placeholder="Type your answer"
            onSubmit={(value) => onSubmit(value)}
          />
          <Box marginTop={1} width="100%" justifyContent="flex-end">
            <Text>
              <Text color={Colors.accent}>ENTER</Text>
              <Text dimColor> submit</Text>
            </Text>
          </Box>
        </Box>
      );
  }
};
