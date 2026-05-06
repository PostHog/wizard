import { useSyncExternalStore } from 'react';
import { join } from 'node:path';
import { Box } from 'ink';
import type { WizardStore } from '../../store.js';
import {
  TabContainer,
  SplitView,
  LogViewer,
  HNViewer,
} from '../../primitives/index.js';
import { useStdoutDimensions } from '../../hooks/useStdoutDimensions.js';
import { useFileWatcher } from '../../hooks/file-watcher.js';
import { AuditChecksViewer } from './AuditChecksViewer/AuditChecksViewer.js';
import { AuditAreaPane } from './AuditAreaPane.js';
import { PendingChecksList } from './PendingChecksList.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  AUDIT_REPORT_FILE,
  coerceAuditChecks,
  getAuditChecks,
} from '../../../../lib/workflows/audit/types.js';
import { WIZARD_LOG_FILE } from '../../../../utils/paths.js';

interface AuditRunScreenProps {
  store: WizardStore;
}

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
  const latestStatus = statuses?.[statuses.length - 1];

  const [columns] = useStdoutDimensions();
  const checks = getAuditChecks(store.session);
  const reportPath = `./${AUDIT_REPORT_FILE}`;
  const pendingChecksList = <PendingChecksList checks={checks} />;
  const areaPane = (
    <AuditAreaPane
      checks={checks}
      reportPath={reportPath}
      latestStatus={latestStatus}
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
