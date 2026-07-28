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
import { copyToClipboard, openInBrowser } from '@utils/clipboard';
import { useKeyBindings } from '@ui/tui/hooks/useKeyBindings';
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
  // What the user last did with the link, so the overlay can confirm it. The
  // auto-copy below seeds 'copied'; pressing `o`/`c` overrides it.
  const [linkStatus, setLinkStatus] = useState<'idle' | 'copied' | 'opened'>(
    'idle',
  );

  // For rich-link prompts (opt-in programs only) copy a lone URL to the
  // clipboard, so users on terminals without OSC 8 support can still paste it.
  // Only fires when the current question has exactly one URL, to avoid
  // clobbering the clipboard ambiguously. `soleUrl` is the sole effect dep.
  const richLinks = pending?.richLinks ?? false;
  const currentPrompt = pending?.questions[index]?.prompt ?? '';
  const promptUrls = richLinks ? extractUrls(currentPrompt) : [];
  const soleUrl = promptUrls.length === 1 ? promptUrls[0] : null;

  // The `o`/`c` keybinds would steal keystrokes from a free-text answer, so
  // only offer them on picker questions (where the user isn't typing).
  const isTextQuestion = pending?.questions[index]?.kind === 'text';
  const canActOnLink = !!soleUrl && !isTextQuestion;

  // Split the prompt at the link so the o/c hint sits right under it, with
  // trailing text below. Falls back to the whole prompt when there's no
  // single-link split.
  const linkSplitIndex =
    canActOnLink && soleUrl ? currentPrompt.indexOf(soleUrl) : -1;
  const splitLink = soleUrl !== null && linkSplitIndex !== -1;
  const linkEnd = splitLink && soleUrl ? linkSplitIndex + soleUrl.length : 0;
  const promptHead = splitLink
    ? currentPrompt.slice(0, linkEnd)
    : currentPrompt;
  const linkTrailingText = splitLink
    ? currentPrompt.slice(linkEnd).replace(/^\s+/, '')
    : '';

  useEffect(() => {
    setLinkStatus('idle');
    if (!soleUrl) return;
    // Seed the clipboard silently for terminals without OSC 8. Status stays
    // 'idle' so the o/c hint shows until the user acts.
    void copyToClipboard(soleUrl);
  }, [soleUrl]);

  // Explicit, discoverable link actions. OSC 8 makes the link clickable only on
  // terminals that support it (not macOS Terminal.app), so `o` opens it in the
  // browser directly — the one path that works everywhere — and `c` copies it
  // as a fallback. Both register hints in the bar via useKeyBindings.
  useKeyBindings(
    'wizard-ask-link',
    canActOnLink && soleUrl
      ? [
          {
            match: 'o',
            label: 'o',
            action: 'open in browser',
            handler: () => {
              void openInBrowser(soleUrl).then((ok) => {
                if (ok) setLinkStatus('opened');
              });
            },
          },
          {
            match: 'c',
            label: 'c',
            action: 'copy link',
            handler: () => {
              void copyToClipboard(soleUrl).then((ok) => {
                if (ok) setLinkStatus('copied');
              });
            },
          },
        ]
      : [],
  );

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
          <LinkText text={promptHead} />
        ) : (
          <Text>{question.prompt}</Text>
        )}
      </Box>
      {/* o/c hint until the user acts, then a confirmation. */}
      {canActOnLink && (
        <Box marginTop={1}>
          {linkStatus === 'idle' ? (
            <Text dimColor>
              Press <Text color={Colors.accent}>o</Text> to open it in your
              browser, or <Text color={Colors.accent}>c</Text> to copy the link.
            </Text>
          ) : linkStatus === 'opened' ? (
            <Text color={Colors.success}>
              {Icons.check} Opening the link in your browser…
            </Text>
          ) : (
            <Text color={Colors.success}>
              {Icons.check} Link copied to clipboard. Paste it in your browser.
            </Text>
          )}
        </Box>
      )}
      {/* Prompt text after the link */}
      {linkTrailingText && (
        <Box marginTop={1}>
          <Text>{linkTrailingText}</Text>
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
