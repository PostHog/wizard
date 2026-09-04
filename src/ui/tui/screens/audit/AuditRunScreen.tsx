import { useSyncExternalStore } from 'react';
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
import { AuditChecksViewer } from './AuditChecksViewer/AuditChecksViewer.js';
import { AuditAreaPane } from './AuditAreaPane.js';
import { AUDIT_AREA_SLIDES } from './slides/index.js';
import { EVENTS_AUDIT_AREA_SLIDES } from './slides/events-audit/index.js';
import { CULL_AREA_SLIDES } from './slides/cull/index.js';
import { cullStageCopy } from './slides/cull/stage.js';
import { PendingChecksList } from './PendingChecksList.js';
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
  const pendingChecksList = <PendingChecksList checks={checks} />;
  const slides = slidesFor(store.router.activeProgram, store.session.skillId);
  const wrapUp =
    store.router.activeProgram === 'cull-feature-flags'
      ? cullStageCopy(checks, reportPath)
      : undefined;
  const areaPane = (
    <AuditAreaPane
      checks={checks}
      reportPath={reportPath}
      slides={slides}
      dashboardUrl={store.session.dashboardUrl}
      notebookUrl={store.session.notebookUrl}
      wrapUp={wrapUp}
    />
  );

  // Narrow terminals: drop the area pane.
  const statusComponent =
    columns < 80 ? (
      <Box flexDirection="column" flexGrow={1}>
        {pendingChecksList}
      </Box>
    ) : (
      <SplitView left={areaPane} right={pendingChecksList} />
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
