import { useSyncExternalStore } from 'react';
import { join } from 'node:path';
import type { WizardStore } from '../../store.js';
import { TabContainer, LogViewer, HNViewer } from '../../primitives/index.js';
import { useFileWatcher } from '../../hooks/file-watcher.js';
import { AuditChecksViewer } from './AuditChecksViewer/AuditChecksViewer.js';
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
  // the Up next tab reflects updates within the poll interval.
  useFileWatcher(join(store.session.installDir, AUDIT_CHECKS_FILE), (parsed) =>
    store.setFrameworkContext(AUDIT_CHECKS_KEY, coerceAuditChecks(parsed)),
  );

  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  const tabs = [
    {
      id: 'audit-checks',
      label: 'Up next',
      component: (
        <AuditChecksViewer
          checks={getAuditChecks(store.session)}
          currentStatus={store.statusMessages.at(-1)}
        />
      ),
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
