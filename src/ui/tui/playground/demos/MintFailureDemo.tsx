import { Box, Text } from 'ink';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { OutroKind } from '@lib/wizard-session';
import { useKeyBindings } from '@ui/tui/hooks/useKeyBindings';
import { MintFailureScreen } from '@ui/tui/screens/MintFailureScreen';
import { WizardStore } from '@ui/tui/store';

const leaveSpellbook = () =>
  Promise.resolve({
    path: '/example/project/POSTHOG_WIZARD_SPELLBOOK.md',
    skillsIncluded: true,
  });

export const MintFailureDemo = () => {
  const [revision, setRevision] = useState(0);
  const store = useMemo(() => {
    const isolated = new WizardStore();
    isolated.setOutroData({ kind: OutroKind.Error });
    return isolated;
  }, [revision]);

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );
  useKeyBindings('mint-failure-demo', [
    {
      match: 'r',
      label: 'r',
      action: 'replay preview',
      handler: () => setRevision((current) => current + 1),
    },
  ]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text dimColor>
        Preview only — no files are written. Press r to replay.
      </Text>
      {store.session.outroDismissed ? (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text>Preview complete. Press r to replay.</Text>
        </Box>
      ) : (
        <MintFailureScreen
          key={revision}
          store={store}
          leaveSpellbook={leaveSpellbook}
        />
      )}
    </Box>
  );
};
