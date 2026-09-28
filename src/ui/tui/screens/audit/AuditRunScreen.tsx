import { useSyncExternalStore } from 'react';
import { Box } from 'ink';
import type { WizardStore } from '@ui/tui/store';
import {
  TabContainer,
  SplitView,
  LogViewer,
  HNViewer,
} from '@ui/tui/primitives/index';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { AuditChecksViewer } from './AuditChecksViewer/AuditChecksViewer.js';
import { AuditAreaPane } from './AuditAreaPane.js';
import { AUDIT_AREA_SLIDES } from './slides/index.js';
import { EVENTS_AUDIT_AREA_SLIDES } from './slides/events-audit/index.js';
import { PendingChecksList } from './PendingChecksList.js';
import { AUDIT_REPORT_FILE, getAuditChecks } from '@lib/programs/audit/types';
import { getProgramConfig } from '@lib/programs/program-registry';
import { WIZARD_LOG_FILE } from '@utils/paths';

interface AuditRunScreenProps {
  store: WizardStore;
}

export const AuditRunScreen = ({ store }: AuditRunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // The ledger reaches the store through `AuditLedgerWatcher`, which runs for
  // headless runs too. This screen only renders what the store holds.
  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  const [columns] = useStdoutDimensions();
  const checks = getAuditChecks(store.session);
  const reportFile =
    getProgramConfig(store.router.activeProgram).reportFile ??
    AUDIT_REPORT_FILE;
  const reportPath = `./${reportFile}`;
  const pendingChecksList = <PendingChecksList checks={checks} />;
  const slides =
    store.session.skillId === 'audit-events'
      ? EVENTS_AUDIT_AREA_SLIDES
      : AUDIT_AREA_SLIDES;
  const areaPane = (
    <AuditAreaPane
      checks={checks}
      reportPath={reportPath}
      slides={slides}
      dashboardUrl={store.session.dashboardUrl}
      notebookUrl={store.session.notebookUrl}
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
