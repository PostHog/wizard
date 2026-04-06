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
import type { WizardStore } from '@tui/store.js';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
  HNViewer,
} from '@tui/primitives/index.js';
import type { ProgressItem } from '@tui/primitives/index.js';
import { TaskStatus } from '@ui/wizard-ui.js';
import { ADDITIONAL_FEATURE_LABELS } from '@lib/wizard-session.js';
import { LearnCard } from '@tui/components/LearnCard.js';
import { TipsCard } from '@tui/components/TipsCard.js';
import { useStdoutDimensions } from '@tui/hooks/useStdoutDimensions.js';

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

  // Build stage-grouped progress items
  const progressItems: ProgressItem[] = [];
  const current = store.currentQueueItem;
  const completed = store.completedQueueItems;
  const pendingQueue = store.workQueue?.toArray() ?? [];

  // Completed stages
  for (const item of completed) {
    progressItems.push({
      label: item.label,
      status: TaskStatus.Completed,
    });
  }

  // Current stage header + nested agent tasks
  if (current) {
    progressItems.push({
      label: current.label,
      activeForm: current.label,
      status: TaskStatus.InProgress,
    });
    // Nest agent tasks under current stage
    for (const t of store.tasks) {
      progressItems.push({
        label: t.label,
        activeForm: t.activeForm,
        status: t.status,
        indent: 1,
      });
    }
  }

  // Pending queue items
  for (const item of pendingQueue) {
    progressItems.push({
      label: item.label,
      status: TaskStatus.Pending,
    });
  }

  // Additional features waiting
  const featureQueue = store.session.additionalFeatureQueue;
  for (const feature of featureQueue) {
    const nextLabel = ADDITIONAL_FEATURE_LABELS[feature];
    progressItems.push({
      label: `Set up ${nextLabel}`,
      status: TaskStatus.Pending,
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
