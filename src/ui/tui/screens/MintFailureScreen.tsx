import { Box, Text } from 'ink';
import { useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { MINT_FAILURE_MESSAGE, MINT_FAILURE_CONTACT } from '@ui/mint-failure';
import type { WizardSpellbook } from '@lib/wizard-spellbook';

export type MintFailureServices = {
  leaveSpellbook: () => Promise<WizardSpellbook>;
  logPath: string;
};

type Action = 'save' | 'report' | 'continue' | 'exit' | 'retry';

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
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const { spellbook } = store.session;

  const select = async (action: Action) => {
    if (busy.current) return;
    if (action === 'exit' || action === 'continue')
      return store.setAgentHandoff(action);
    if (action === 'report') return setReport(true);
    busy.current = true;
    setError(null);
    setWorking(true);
    try {
      const saved =
        store.session.spellbook ?? (await services.leaveSpellbook());
      store.setSpellbook(saved);
      store.setAgentHandoff('continue');
    } catch {
      setError(
        'Could not save the skills. Check this folder is writable and try again.',
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };

  const choices: [string, Action][] = error
    ? [['Try again', 'retry']]
    : report
    ? [['Save skills', 'save']]
    : [
        ['Save skills', 'save'],
        ['Report this issue', 'report'],
      ];
  choices.push(['Exit', 'exit']);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        width={Math.max(1, Math.min(68, columns - 4))}
        flexDirection="column"
        gap={1}
      >
        <Text>{report ? MINT_FAILURE_CONTACT : MINT_FAILURE_MESSAGE}</Text>
        {report && (
          <Text color="cyan" wrap="wrap">
            {services.logPath}
          </Text>
        )}
        {error && <Text color="red">{error}</Text>}
        {spellbook && (
          <Box flexDirection="column">
            <Text color="cyan" wrap="wrap">
              {spellbook.path}
            </Text>
            <Text>
              {spellbook.skillsIncluded
                ? 'Ask your agent to read this file and complete the task.'
                : 'The skills could not be downloaded. This file contains task instructions and documentation links for your agent.'}
            </Text>
          </Box>
        )}
        {working ? (
          <Text>Saving skills...</Text>
        ) : (
          <PickerMenu
            key={report ? 'report' : error ? 'error' : 'menu'}
            options={choices.map(([label, value]) => ({ label, value }))}
            onSelect={(action) => void select(action as Action)}
          />
        )}
      </Box>
    </Box>
  );
}
