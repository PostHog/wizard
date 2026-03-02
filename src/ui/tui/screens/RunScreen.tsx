/**
 * RunScreen — Tabbed observational view of the agent run.
 *
 * Two tabs:
 *   - Status: SplitView with TipsCard (left) + ProgressList (right)
 *   - Logs: LogViewer tailing the wizard log file
 *
 * No prompts — the agent runs headlessly.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
} from '../primitives/index.js';
import type { ProgressItem } from '../primitives/index.js';
import { Colors } from '../styles.js';

const LOG_FILE = '/tmp/posthog-wizard.log';

interface RunScreenProps {
  store: WizardStore;
}

const TipsCard = () => {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Tip
      </Text>
      <Box height={1} />
      <Text dimColor>
        We'll put a call to action here based on what we've detected in their
        project.
      </Text>
    </Box>
  );
};

export const RunScreen = ({ store }: RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  const lastStatus =
    store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : undefined;

  const tabs = [
    {
      id: 'status',
      label: 'Status',
      component: (
        <SplitView
          left={<TipsCard />}
          right={<ProgressList items={progressItems} title="Tasks" />}
        />
      ),
    },
    {
      id: 'logs',
      label: 'All logs',
      component: <LogViewer filePath={LOG_FILE} />,
    },
  ];

  return <TabContainer tabs={tabs} statusMessage={lastStatus} />;
};
