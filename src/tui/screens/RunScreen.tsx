/**
 * RunScreen — Default observational view of the agent run.
 *
 * Tabs: Status (LearnCard + ProgressList), Event plan (when present),
 * Tail logs, HN. Programs that need a different tab list ship their own
 * screen component (see audit/AuditRunScreen.tsx).
 */

import { useMemo, useSyncExternalStore } from 'react';
import { Box } from 'ink';
import type { WizardStore } from '@tui/store';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
  HNViewer,
} from '@tui/primitives/index';
import type { ProgressItem } from '@tui/primitives/index';
import { LearnCard } from '@tui/components/LearnCard';
import { VisualizerTab } from '@tui/components/PhaseVisuals';
import { TipsCard } from '@tui/components/TipsCard';
import { useStdoutDimensions } from '@tui/hooks/useStdoutDimensions';

import { flowOwner } from '@tui/flow-owner';
import { getContentBlocks as getSkillContentBlocks } from '@tui/programs/shared/skill-deck';

import { getLogFilePath } from '@utils/debug';

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

  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  // Each program's deck lives in its TUI folder (`programs/<id>/deck`). Fall
  // back to the agent-skill deck for programs without one and for
  // runtime-created configs (e.g. `wizard skill <id>`).
  const activeProgram = store.router.activeProgram;
  const learnBlocks = useMemo(() => {
    const getBlocks = flowOwner(activeProgram).deck ?? getSkillContentBlocks;
    return getBlocks(store);
  }, [store, activeProgram]);

  // Program-supplied tips for the right pane; undefined falls back to
  // DEFAULT_TIPS inside TipsCard, so non-self-driving programs are unaffected.
  const programTips = flowOwner(activeProgram).tips?.(store);

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
      component: <LogViewer filePath={getLogFilePath()} />,
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
