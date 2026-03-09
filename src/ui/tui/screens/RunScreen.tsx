/**
 * RunScreen — Tabbed observational view of the agent run.
 *
 * Two tabs:
 *   - Status: SplitView with LearnCard (left) + ProgressList (right)
 *   - Logs: LogViewer tailing the wizard log file
 *
 * No prompts — the agent runs headlessly.
 * LearnCard shows animated educational content and reacts to discovered features.
 */

import { useSyncExternalStore } from 'react';
import { Box } from 'ink';
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
  HNViewer,
} from '../primitives/index.js';
import type { ProgressItem } from '../primitives/index.js';
import { ADDITIONAL_FEATURE_LABELS } from '../../../lib/wizard-session.js';
import { LearnCard } from '../components/LearnCard.js';
import { TipsCard } from '../components/TipsCard.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

const LOG_FILE = '/tmp/posthog-wizard.log';

interface RunScreenProps {
  store: WizardStore;
}

export const RunScreen = ({ store }: RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [columns] = useStdoutDimensions();

  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  // When all tasks are done but the queue has features, show a transitional item
  const queue = store.session.additionalFeatureQueue;
  const allDone =
    progressItems.length > 0 &&
    progressItems.every((t) => t.status === 'completed');
  if (allDone && queue.length > 0) {
    const nextLabel = ADDITIONAL_FEATURE_LABELS[queue[0]];
    progressItems.push({
      label: `Set up ${nextLabel}`,
      activeForm: `Setting up ${nextLabel}...`,
      status: 'in_progress',
    });
  }

  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  const leftPane = store.learnCardComplete ? (
    <TipsCard store={store} />
  ) : (
    <LearnCard store={store} onComplete={() => store.setLearnCardComplete()} />
  );
  const progressList = <ProgressList items={progressItems} title="Tasks" />;

  // On narrow terminals, drop the learn pane and show only progress
  const statusComponent =
    columns < 80 ? (
      <Box flexDirection="column" flexGrow={1}>
        {progressList}
      </Box>
    ) : (
      <SplitView left={leftPane} right={progressList} />
    );

  const tabs = [
    {
      id: 'status',
      label: 'Status',
      component: statusComponent,
    },
    ...(store.eventPlan.length > 0
      ? [
          {
            id: 'events',
            label: 'Event plan',
            component: <EventPlanViewer events={store.eventPlan} />,
          },
        ]
      : []),
    {
      id: 'logs',
      label: 'Tail logs',
      component: <LogViewer filePath={LOG_FILE} />,
    },
    {
      id: 'hn',
      label: 'HN',
      component: <HNViewer />,
    },
  ];

  return (
    <TabContainer
      tabs={tabs}
      statusMessage={statuses}
      expandableStatus
      store={store}
    />
  );
};
