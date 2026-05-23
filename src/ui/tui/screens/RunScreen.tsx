/**
 * RunScreen — Default observational view of the agent run.
 *
 * Tabs: Status (LearnCard + ProgressList), Event plan (when present),
 * Tail logs, HN. Workflows that need a different tab list ship their own
 * screen component (see audit/AuditRunScreen.tsx).
 */

import { useMemo, useSyncExternalStore } from 'react';
import { join } from 'node:path';
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
import { useFileWatcher } from '../hooks/file-watcher.js';
import { EVENT_PLAN_FILE } from '../../../lib/workflows/posthog-integration/index.js';
import { getWorkflowConfig } from '../../../lib/workflows/workflow-registry.js';
import { getContentBlocks as getSkillContentBlocks } from '../../../lib/workflows/agent-skill/content/index.js';

import { WIZARD_LOG_FILE } from '../../../utils/paths.js';

interface RunScreenProps {
  store: WizardStore;
}

export const RunScreen = ({ store }: RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // Mirror the agent's `.posthog-events.json` plan into the store so the
  // Event plan tab appears as soon as the agent emits the file.
  useFileWatcher(join(store.session.installDir, EVENT_PLAN_FILE), (parsed) => {
    if (!Array.isArray(parsed)) return;
    store.setEventPlan(
      parsed.map((e: Record<string, unknown>) => ({
        name: (e.name ?? e.event ?? '') as string,
        description: (e.description ?? '') as string,
      })),
    );
  });

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

  // Each workflow owns its content deck (workflow/content/index.tsx)
  // and wires it onto its WorkflowConfig.getContentBlocks. Fall back to the
  // agent-skill deck for runtime-created configs (e.g. `--skill <id>`) that
  // aren't in the static registry.
  const activeFlow = store.router.activeFlow;
  const learnBlocks = useMemo(() => {
    const getBlocks =
      getWorkflowConfig(activeFlow)?.getContentBlocks ?? getSkillContentBlocks;
    return getBlocks(store);
  }, [store, activeFlow]);

  const leftPane = store.learnCardComplete ? (
    <TipsCard store={store} />
  ) : (
    <LearnCard
      store={store}
      blocks={learnBlocks}
      onComplete={() => store.setLearnCardComplete()}
    />
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
