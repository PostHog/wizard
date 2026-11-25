import { Box, Text } from 'ink';
import { useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@tui/store';
import { PickerMenu } from '@tui/primitives/index';
import { useStdoutDimensions } from '@tui/hooks/useStdoutDimensions';
import { Colors, Icons } from '@tui/styles';
import {
  MINT_FAILURE_MESSAGE,
  MINT_FAILURE_BODY,
  REPORT_PROMPT,
  REPORT_SENT,
  RUN_FAILURE_BODY,
  RUN_FAILURE_HEADLINE,
  isCapacityFailure,
} from '@tui/mint-failure';
import type { WizardSpellbook } from '@tui/services/wizard-spellbook';
import type { CodingAgent } from '../services/coding-agent-launcher';

export type MintFailureServices = {
  leaveSpellbook: () => Promise<WizardSpellbook>;
  openAgent: (agent: CodingAgent, spellbookPath: string) => Promise<void>;
};

type Action =
  | 'save'
  | CodingAgent
  | 'send-report'
  | 'skip-report'
  | 'continue'
  | 'exit'
  | 'retry';

export function MintFailureScreen({
  store,
  services,
}: {
  store: WizardStore;
  services: MintFailureServices;
}) {
  const [columns] = useStdoutDimensions();
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );
  const busy = useRef(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportChoice, setReportChoice] = useState<'sent' | 'skipped' | null>(
    null,
  );
  const [retry, setRetry] = useState<'save' | CodingAgent>('save');
  const { spellbook } = store;
  const isCapacity = isCapacityFailure(store.session);
  const failureMessage = store.session.outroData?.message;

  const select = async (action: Action) => {
    if (busy.current) return;
    if (action === 'exit' || action === 'continue')
      return store.setMintHandoff(action);
    if (action === 'skip-report') return setReportChoice('skipped');
    if (action === 'send-report') {
      store.sendFailureReport();
      return setReportChoice('sent');
    }
    const task = action === 'retry' ? retry : action;
    setRetry(task);
    busy.current = true;
    setError(null);
    setWorking('Saving skill...');
    try {
      const saved = store.spellbook ?? (await services.leaveSpellbook());
      store.setSpellbook(saved);
      if (task !== 'save') {
        setWorking(`Opening ${task === 'claude' ? 'Claude Code' : 'Codex'}...`);
        await services.openAgent(task, saved.path);
        store.setMintHandoff('continue');
      }
    } catch (err) {
      setError(
        store.spellbook
          ? err instanceof Error
            ? err.message
            : 'Could not open your agent.'
          : 'Could not save the skill. Check this folder is writable and try again.',
      );
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  const options: { label: string; value: Action }[] = error
    ? [
        { label: 'Try again', value: 'retry' },
        ...(spellbook
          ? [{ label: 'Continue setup', value: 'continue' as const }]
          : []),
        { label: 'Exit', value: 'exit' },
      ]
    : spellbook
    ? [
        { label: 'Continue', value: 'continue' },
        { label: 'Exit', value: 'exit' },
      ]
    : reportChoice === null
    ? [
        { label: 'Send report', value: 'send-report' },
        { label: "Don't send", value: 'skip-report' },
      ]
    : [
        { label: 'Save skill', value: 'save' },
        { label: 'Open in Claude Code', value: 'claude' },
        { label: 'Open in Codex', value: 'codex' },
        { label: 'Exit', value: 'exit' },
      ];

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        width={Math.max(1, Math.min(78, columns - 4))}
        flexDirection="column"
        alignItems="center"
      >
        {spellbook ? (
          <Text color={Colors.success} bold>
            {Icons.check} Skill saved
          </Text>
        ) : (
          <Text color={Colors.error} bold>
            ✘ {isCapacity ? MINT_FAILURE_MESSAGE : RUN_FAILURE_HEADLINE}
          </Text>
        )}
        {!spellbook && !isCapacity && failureMessage && (
          <Box marginTop={1}>
            <Text wrap="wrap">{failureMessage}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text>
            {spellbook
              ? spellbook.skillsIncluded
                ? 'Ask your agent to read this file and complete the task.'
                : 'The skill could not be downloaded. This file has instructions and links for your agent.'
              : reportChoice === null
              ? REPORT_PROMPT
              : isCapacity
              ? MINT_FAILURE_BODY
              : RUN_FAILURE_BODY}
          </Text>
        </Box>
        {reportChoice === 'sent' && !spellbook && (
          <Box marginTop={1}>
            <Text dimColor>{REPORT_SENT}</Text>
          </Box>
        )}
        {spellbook && (
          <Box marginTop={1}>
            <Text color="cyan" wrap="wrap">
              {spellbook.path}
            </Text>
          </Box>
        )}
        {error && (
          <Box marginTop={1}>
            <Text color={Colors.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          {working ? (
            <Text>{working}</Text>
          ) : (
            <PickerMenu
              key={[reportChoice, Boolean(spellbook), Boolean(error)].join('-')}
              options={options}
              onSelect={(action) => void select(action as Action)}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
