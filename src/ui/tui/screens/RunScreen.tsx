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
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  SplitView,
  ScrollableProgress,
  LogViewer,
  EventPlanViewer,
  HNViewer,
} from '../primitives/index.js';
import type { ProgressItem, ProgressGroup } from '../primitives/index.js';
import { ADDITIONAL_FEATURE_LABELS } from '../../../lib/wizard-session.js';
import { LearnCard } from '../components/LearnCard.js';
import { TipsCard } from '../components/TipsCard.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

const LOG_FILE = '/tmp/posthog-wizard.log';

interface RunScreenProps {
  store: WizardStore;
}

/** Rows consumed by TitleBar + spacer + ScreenContainer padding + status bar + tab bar */
const CHROME_ROWS = 8;

export const RunScreen = ({ store }: RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [columns, rows] = useStdoutDimensions();

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

  // Build progress groups: base tasks + per-migration groups
  const progressGroups: ProgressGroup[] = [
    { title: 'Tasks', items: progressItems },
  ];
  for (const [feature, data] of store.migrationTasks) {
    progressGroups.push({
      title: ADDITIONAL_FEATURE_LABELS[feature],
      items: data.tasks.map((t) => ({
        label: t.label,
        activeForm: t.activeForm,
        status: t.status,
      })),
      failed: data.status === 'failed',
    });
  }

  // Compute available height for the progress pane
  const statusRows = statuses
    ? Math.min(store.statusExpanded ? 10 : 2, statuses.length) + 2
    : 0;
  const availableHeight = Math.max(8, rows - CHROME_ROWS - statusRows);

  const leftPane = store.learnCardComplete ? (
    <TipsCard store={store} />
  ) : (
    <LearnCard store={store} onComplete={() => store.setLearnCardComplete()} />
  );

  const progressPane = (
    <ScrollableProgress groups={progressGroups} maxHeight={availableHeight} />
  );

  // On narrow terminals, drop the learn pane and show only progress
  const statusComponent =
    columns < 80 ? (
      progressPane
    ) : (
      <SplitView left={leftPane} right={progressPane} />
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
