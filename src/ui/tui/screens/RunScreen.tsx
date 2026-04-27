/**
 * RunScreen — Tabbed observational view of the agent run.
 *
 * The tab list is workflow-driven via `getWorkflowRunScreenTabs`. Each entry
 * is either a built-in tab id (resolved by `builtInTab` below) or a full
 * workflow-contributed tab spec. No prompts — the agent runs headlessly.
 */

import { useSyncExternalStore, type ReactNode } from 'react';
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
import { getWorkflowRunScreenTabs } from '../../../lib/workflows/workflow-renderers.js';

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

  const builtInTab = (id: 'status' | 'event-plan' | 'logs' | 'hn') => {
    switch (id) {
      case 'status':
        return { id: 'status', label: 'Status', component: statusComponent };
      case 'event-plan':
        return store.eventPlan.length > 0
          ? {
              id: 'events',
              label: 'Event plan',
              component: <EventPlanViewer events={store.eventPlan} />,
            }
          : null;
      case 'logs':
        return {
          id: 'logs',
          label: 'Tail logs',
          component: <LogViewer filePath={LOG_FILE} />,
        };
      case 'hn':
        return { id: 'hn', label: 'HN', component: <HNViewer /> };
    }
  };

  const tabs: Array<{ id: string; label: string; component: ReactNode }> = [];
  for (const spec of getWorkflowRunScreenTabs(store.router.activeFlow)) {
    if (typeof spec === 'string') {
      const built = builtInTab(spec);
      if (built) tabs.push(built);
    } else if (spec.show(store.session)) {
      tabs.push({
        id: spec.id,
        label: spec.label,
        component: spec.render({ session: store.session, tasks: store.tasks }),
      });
    }
  }

  return (
    <TabContainer
      tabs={tabs}
      statusMessage={statuses}
      expandableStatus
      store={store}
    />
  );
};
