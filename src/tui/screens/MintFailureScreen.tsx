import { Box, Text } from 'ink';
import { useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@tui/store';
import { PickerMenu } from '@tui/primitives/index';
import { useStdoutDimensions } from '@tui/hooks/useStdoutDimensions';
import { Colors, Icons } from '@tui/styles';
import {
  AGENT_HANDOFF_STEP,
  LOG_PROMPT,
  LOG_SENT_NOTE,
  REPORTED_NOTE,
  RERUN_COMMAND,
  RETRY_HEADLINE,
  failureCopy,
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
  | 'send-log'
  | 'keep-log'
  | 'continue'
  | 'exit'
  | 'retry';

type LogChoice = 'unanswered' | 'sent' | 'kept';

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
  const [logChoice, setLogChoice] = useState<LogChoice>('unanswered');
  const [retry, setRetry] = useState<'save' | CodingAgent>('save');
  const { spellbook } = store;
  const copy = failureCopy(store.session);

  const select = async (action: Action) => {
    if (busy.current) return;
    if (action === 'exit' || action === 'continue')
      return store.setMintHandoff(action);
    if (action === 'keep-log') return setLogChoice('kept');
    if (action === 'send-log') {
      store.sendFailureReport();
      return setLogChoice('sent');
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

  const isAskingAboutLog = logChoice === 'unanswered' && !spellbook && !error;

  const options: { label: string; value: Action }[] = isAskingAboutLog
    ? [
        { label: 'Send log', value: 'send-log' },
        { label: "Don't send", value: 'keep-log' },
      ]
    : error
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
    : [
        { label: 'Open in Claude Code', value: 'claude' },
        { label: 'Open in Codex', value: 'codex' },
        { label: 'Save skill', value: 'save' },
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
          <>
            <Text color={Colors.success} bold>
              {Icons.check} Skill saved
            </Text>
            <Box marginTop={1}>
              <Text>
                {spellbook.skillsIncluded
                  ? 'Ask your agent to read this file and complete the task.'
                  : 'The skill could not be downloaded. This file has instructions and links for your agent.'}
              </Text>
            </Box>
          </>
        ) : isAskingAboutLog ? (
          <Box flexDirection="column" width="100%">
            <Text color={Colors.error} bold>
              ✘ {copy.headline}
            </Text>
            <Text wrap="wrap">
              {copy.cause} {REPORTED_NOTE}
            </Text>
            <Box marginTop={1}>
              <Text wrap="wrap">{LOG_PROMPT}</Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" width="100%">
            {logChoice === 'sent' && (
              <Box marginBottom={1}>
                <Text color={Colors.success}>
                  {Icons.check} {LOG_SENT_NOTE}
                </Text>
              </Box>
            )}
            <Text bold>{RETRY_HEADLINE}</Text>
            <Box marginTop={1}>
              <Text wrap="wrap">
                1. {copy.rerun} <Text color="cyan">{RERUN_COMMAND}</Text>
              </Text>
            </Box>
            <Text wrap="wrap">2. {AGENT_HANDOFF_STEP}</Text>
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
              key={[logChoice, Boolean(spellbook), Boolean(error)].join('-')}
              options={options}
              onSelect={(action) => void select(action as Action)}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
