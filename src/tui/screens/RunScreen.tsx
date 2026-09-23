/**
 * RunScreen — Default observational view of the agent run.
 *
 * Tabs: Status (LearnCard + ProgressList), Event plan (when present),
 * Tail logs, HN. Programs that need a different tab list ship their own
 * screen component (see audit/AuditRunScreen.tsx).
 */

import { useMemo, useSyncExternalStore } from 'react';
import { Box } from 'ink';
import type { WizardStore } from '../store';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
  HNViewer,
} from '../primitives/index';
import type { ProgressItem } from '../primitives/index';
import { LearnCard } from '../components/LearnCard';
import { VisualizerTab } from '../components/PhaseVisuals';
import { TipsCard } from '../components/TipsCard';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions';

import { getProgramContentBlocks, getProgramTips } from '../decks/registry';

import { WIZARD_LOG_FILE } from '@utils/paths';
import { ADDITIONAL_FEATURE_LABELS } from '@shared/constants';

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

  const activeProgram = store.router.activeProgram;
  const learnBlocks = useMemo(
    () => getProgramContentBlocks(activeProgram, store),
    [store, activeProgram],
  );

  // Program-supplied tips for the right pane; undefined falls back to
  // DEFAULT_TIPS inside TipsCard, so non-self-driving programs are unaffected.
  const programTips = getProgramTips(activeProgram, store);

  const leftPane = store.learnCardComplete ? (
    <TipsCard store={store} tips={programTips} />
  ) : (
    <LearnCard
      store={store}
      blocks={learnBlocks}
      onComplete={() => store.setLearnCardComplete()}
    />
  );
  const progressList = <ProgressList items={progressItems} title="Tasks" />;

  const statusComponent =
    columns < 80 ? (
      <Box flexDirection="column" flexGrow={1}>
        {progressList}
      </Box>
    ) : (
      <SplitView left={leftPane} right={progressList} />
    );

  const tabs = [
    { id: 'status', label: 'Status', component: statusComponent },
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
      component: <LogViewer filePath={WIZARD_LOG_FILE} />,
    },
    {
      id: 'visualizer',
      label: 'Visualizer',
      component: <VisualizerTab store={store} />,
    },
    { id: 'hn', label: 'HN', component: <HNViewer /> },
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
