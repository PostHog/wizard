/**
 * RunScreen — Tabbed observational view of the agent run.
 *
 * Two tabs:
 *   - Status: SplitView with ProgressList (left) + placeholder (right)
 *   - Logs: LogViewer tailing the wizard log file
 *
 * No prompts — the agent runs headlessly.
 */

import { Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
} from '../primitives/index.js';
import type { ProgressItem } from '../primitives/index.js';

const LOG_FILE = '/tmp/posthog-wizard.log';

interface RunScreenProps {
  store: WizardStore;
}

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
          left={<ProgressList items={progressItems} title="Tasks" />}
          right={
            <Text dimColor>
              {lastStatus || 'Waiting for agent to start...'}
            </Text>
          }
        />
      ),
    },
    {
      id: 'logs',
      label: 'All Logs',
      component: <LogViewer filePath={LOG_FILE} />,
    },
  ];

  return <TabContainer tabs={tabs} statusMessage={lastStatus} />;
};
