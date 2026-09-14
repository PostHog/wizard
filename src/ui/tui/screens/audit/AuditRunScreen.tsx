import { useMemo, useSyncExternalStore } from 'react';
import { join } from 'node:path';
import { Box } from 'ink';
import type { WizardStore } from '@ui/tui/store';
import {
  TabContainer,
  SplitView,
  LogViewer,
  HNViewer,
} from '@ui/tui/primitives/index';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { useFileWatcher } from '@ui/tui/hooks/file-watcher';
import { LearnCard } from '@ui/tui/components/LearnCard';
import { AuditChecksViewer } from './AuditChecksViewer/AuditChecksViewer.js';
import { AuditAreaPane } from './AuditAreaPane.js';
import { AUDIT_AREA_SLIDES } from './slides/index.js';
import { EVENTS_AUDIT_AREA_SLIDES } from './slides/events-audit/index.js';
import { CULL_AREA_SLIDES } from './slides/cull/index.js';
import { cullPhase } from './slides/cull/phase.js';
import { PendingChecksList } from './PendingChecksList.js';
import { CullFlagList, PhaseStepper } from './cull/CullFlagList.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  AUDIT_REPORT_FILE,
  coerceAuditChecks,
  getAuditChecks,
} from '@lib/programs/audit/types';
import { getProgramConfig } from '@lib/programs/program-registry';
import { WIZARD_LOG_FILE } from '@utils/paths';

interface AuditRunScreenProps {
  store: WizardStore;
}

const slidesFor = (activeProgram: string, skillId: string | null) => {
  if (activeProgram === 'cull-feature-flags') return CULL_AREA_SLIDES;
  if (skillId === 'audit-events') return EVENTS_AUDIT_AREA_SLIDES;
  return AUDIT_AREA_SLIDES;
};

export const AuditRunScreen = ({ store }: AuditRunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // Mirror the agent's audit ledger into the store.
  useFileWatcher(join(store.session.installDir, AUDIT_CHECKS_FILE), (parsed) =>
    store.setFrameworkContext(AUDIT_CHECKS_KEY, coerceAuditChecks(parsed)),
  );

  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  const [columns] = useStdoutDimensions();
  const checks = getAuditChecks(store.session);
  const reportFile =
    getProgramConfig(store.router.activeProgram).reportFile ??
    AUDIT_REPORT_FILE;
  const reportPath = `./${reportFile}`;
  const activeProgram = store.router.activeProgram;
  const isCull = activeProgram === 'cull-feature-flags';
  const slides = slidesFor(activeProgram, store.session.skillId);
  const { phase, copy } = isCull
    ? cullPhase(checks, store.cullProgress, reportPath)
    : { phase: undefined, copy: undefined };
  const learnBlocks = useMemo(() => {
    if (activeProgram !== 'cull-feature-flags') return undefined;
    return getProgramConfig(activeProgram).getContentBlocks?.(store);
  }, [activeProgram, store]);
  const showLearnDeck =
    isCull && phase === 'verify' && !store.learnCardComplete && !!learnBlocks;
  let leftPane = (
    <AuditAreaPane
      checks={checks}
      reportPath={reportPath}
      slides={slides}
      dashboardUrl={store.session.dashboardUrl}
      notebookUrl={store.session.notebookUrl}
      wrapUp={copy}
    />
  );
  if (showLearnDeck) {
    leftPane = (
      <LearnCard
        store={store}
        blocks={learnBlocks}
        onComplete={() => store.setLearnCardComplete()}
      />
    );
  }

  const pendingChecksList = <PendingChecksList checks={checks} />;
  const cullFlagList = phase ? (
    <CullFlagList checks={checks} progress={store.cullProgress} phase={phase} />
  ) : null;
  const rightPane = isCull ? cullFlagList : pendingChecksList;

  // Narrow terminals: drop the area pane.
  const statusLayout =
    columns < 80 ? (
      <Box flexDirection="column" flexGrow={1}>
        {rightPane}
      </Box>
    ) : (
      <SplitView left={leftPane} right={rightPane} />
    );
  const statusComponent =
    isCull && phase ? (
      <Box flexDirection="column" flexGrow={1}>
        <PhaseStepper phase={phase} />
        {statusLayout}
      </Box>
    ) : (
      statusLayout
    );

  const tabs = [
    { id: 'status', label: 'Status', component: statusComponent },
    {
      id: 'audit-checks',
      label: 'Audit plan',
      component: <AuditChecksViewer checks={checks} />,
    },
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
