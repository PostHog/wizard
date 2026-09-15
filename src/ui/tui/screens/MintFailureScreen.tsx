import { Box, Text } from 'ink';
import { useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { Colors } from '@ui/tui/styles';
import {
  MINT_FAILURE_MESSAGE,
  MINT_FAILURE_BODY,
  MINT_FAILURE_CONTACT,
} from '@ui/mint-failure';
import type { WizardSpellbook } from '@lib/wizard-spellbook';
import type { CodingAgent } from '../services/coding-agent-launcher';

export type MintFailureServices = {
  leaveSpellbook: () => Promise<WizardSpellbook>;
  openAgent: (agent: CodingAgent, spellbookPath: string) => Promise<void>;
  logPath: string;
};

type Action = 'save' | CodingAgent | 'report' | 'continue' | 'exit' | 'retry';

/** Two blocks of the PostHog flag, left of the headline. */
const Mark = () => (
  <Text>
    <Text color="#1D4AFF">█</Text>
    <Text color={Colors.accent}>█</Text>
  </Text>
);

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
  const [report, setReport] = useState(false);
  const [retry, setRetry] = useState<'save' | CodingAgent>('save');
  const { spellbook } = store.session;

  const select = async (action: Action) => {
    if (busy.current) return;
    if (action === 'exit' || action === 'continue')
      return store.setMintHandoff(action);
    if (action === 'report') return setReport(true);
    const task = action === 'retry' ? retry : action;
    setRetry(task);
    busy.current = true;
    setError(null);
    setWorking('Saving skill...');
    try {
      const saved =
        store.session.spellbook ?? (await services.leaveSpellbook());
      store.setSpellbook(saved);
      if (task !== 'save') {
        setWorking(`Opening ${task === 'claude' ? 'Claude Code' : 'Codex'}...`);
        await services.openAgent(task, saved.path);
        store.setMintHandoff('continue');
      }
    } catch (err) {
      setError(
        store.session.spellbook
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
    : report
    ? [
        { label: 'Save skill', value: 'save' },
        { label: 'Exit', value: 'exit' },
      ]
    : [
        { label: 'Save skill', value: 'save' },
        { label: 'Open in Claude Code', value: 'claude' },
        { label: 'Open in Codex', value: 'codex' },
        { label: 'Report this issue', value: 'report' },
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
        <Text bold>
          <Mark /> {spellbook ? 'Skill saved' : MINT_FAILURE_MESSAGE} 🦔
        </Text>
        <Box marginTop={1}>
          <Text>
            {spellbook
              ? spellbook.skillsIncluded
                ? 'Ask your agent to read this file and complete the task.'
                : 'The skill could not be downloaded. This file has instructions and links for your agent.'
              : report
              ? MINT_FAILURE_CONTACT
              : MINT_FAILURE_BODY}
          </Text>
        </Box>
        {report && !spellbook && (
          <Box marginTop={1}>
            <Text color="cyan" wrap="wrap">
              {services.logPath}
            </Text>
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
              key={[report, Boolean(spellbook), Boolean(error)].join('-')}
              options={options}
              onSelect={(action) => void select(action as Action)}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
