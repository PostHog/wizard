import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { TabContainer, LogViewer, HNViewer } from '../../primitives/index.js';
import { AuditChecksViewer } from './AuditChecksViewer/AuditChecksViewer.js';
import { getAuditChecks } from '../../../../lib/workflows/audit/types.js';

const LOG_FILE = '/tmp/posthog-wizard.log';

interface AuditRunScreenProps {
  store: WizardStore;
}

export const AuditRunScreen = ({ store }: AuditRunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
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
          tasks={store.tasks}
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
