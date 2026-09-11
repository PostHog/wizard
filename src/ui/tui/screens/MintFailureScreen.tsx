import { Box, Text, measureElement, type DOMElement } from 'ink';
import { useLayoutEffect, useRef, useState } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { ConfirmationInput } from '@ui/tui/primitives/index';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { useDismissOnAnyKey } from '@ui/tui/hooks/useDismissOnAnyKey';
import { MINT_FAILURE_MESSAGE, MINT_FAILURE_CONTACT } from '@ui/mint-failure';
import type { writeWizardSpellbook } from '@lib/wizard-spellbook';

type Spellbook = Awaited<ReturnType<typeof writeWizardSpellbook>>;

type MintFailureScreenProps = {
  store: WizardStore;
  leaveSpellbook: () => Promise<Spellbook>;
};

enum Phase {
  Ask = 'ask',
  Saving = 'saving',
  Saved = 'saved',
}

export function MintFailureScreen({
  store,
  leaveSpellbook,
}: MintFailureScreenProps) {
  useStdoutDimensions();
  const container = useRef<DOMElement>(null);
  const saving = useRef(false);
  const [width, setWidth] = useState(0);
  const [phase, setPhase] = useState(Phase.Ask);
  const [spellbook, setSpellbook] = useState<Spellbook | null>(null);
  const [error, setError] = useState(false);

  useLayoutEffect(() => {
    if (!container.current) return;
    const measuredWidth = measureElement(container.current).width;
    if (measuredWidth !== width) setWidth(measuredWidth);
  });

  const dismiss = () => store.setOutroDismissed();
  useDismissOnAnyKey(() => {
    if (phase === Phase.Saved) dismiss();
  });
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setError(false);
    setPhase(Phase.Saving);
    try {
      const result = await leaveSpellbook();
      const outro = store.session.outroData;
      if (outro) {
        store.setOutroData({
          ...outro,
          handoffPrompt: `Read ${result.path} and complete the setup described in the Wizard's spell book.`,
        });
      }
      setSpellbook(result);
      setPhase(Phase.Saved);
    } catch {
      setError(true);
      setPhase(Phase.Ask);
    } finally {
      saving.current = false;
    }
  };

  return (
    <Box
      ref={container}
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
    >
      <Box
        width={Math.min(68, width || 68)}
        flexDirection="column"
        alignItems="center"
      >
        {phase === Phase.Saved && spellbook ? (
          <>
            <Text bold>The Wizard left its spell book behind.</Text>
            <Box marginTop={1}>
              <Text wrap="wrap" color="cyan">
                {spellbook.path}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text>
                {spellbook.skillsIncluded
                  ? 'Ask your agent to read it and complete the setup.'
                  : 'Skills could not be downloaded. The spell book includes instructions and links for your agent to continue.'}
              </Text>
            </Box>
          </>
        ) : (
          <Text>{MINT_FAILURE_MESSAGE}</Text>
        )}
        <Box marginTop={1}>
          <Text dimColor>{MINT_FAILURE_CONTACT}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column" alignItems="center">
          {phase === Phase.Saving ? (
            <Text>Leaving the spell book...</Text>
          ) : phase === Phase.Saved ? (
            <Text dimColor>Press any key to exit</Text>
          ) : (
            <>
              {error && (
                <Text color="red">
                  Could not save the spell book. Check this folder is writable
                  and try again.
                </Text>
              )}
              <ConfirmationInput
                message=""
                confirmLabel={error ? 'Try again' : 'Leave spell book'}
                cancelLabel="Exit"
                onConfirm={() => void save()}
                onCancel={dismiss}
              />
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
