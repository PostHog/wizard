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
import { AuditLearnCard } from './AuditLearnCard.js';
import { PendingChecksList } from './PendingChecksList.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  coerceAuditChecks,
  getAuditChecks,
} from '../../../../lib/workflows/audit/types.js';

const LOG_FILE = '/tmp/posthog-wizard.log';

interface AuditRunScreenProps {
  store: WizardStore;
}

export const AuditRunScreen = ({ store }: AuditRunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // Mirror the agent's `.posthog-audit-checks.json` ledger into the store so
  // the Audit plan tab reflects updates within the poll interval.
  useFileWatcher(join(store.session.installDir, AUDIT_CHECKS_FILE), (parsed) =>
    store.setFrameworkContext(AUDIT_CHECKS_KEY, coerceAuditChecks(parsed)),
  );

  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  const [columns] = useStdoutDimensions();
  const checks = getAuditChecks(store.session);
  const pendingChecksList = <PendingChecksList checks={checks} />;

  // On narrow terminals, drop the slideshow pane and show only the checks list.
  const statusComponent =
    columns < 80 ? (
      <Box flexDirection="column" flexGrow={1}>
        {pendingChecksList}
      </Box>
    ) : (
      <SplitView left={<AuditLearnCard />} right={pendingChecksList} />
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
      component: <LogViewer filePath={LOG_FILE} />,
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
