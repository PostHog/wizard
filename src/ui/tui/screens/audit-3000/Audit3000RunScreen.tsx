import { useState, useSyncExternalStore } from 'react';
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
import { AuditChecksViewer } from '../audit/AuditChecksViewer/AuditChecksViewer.js';
import { Audit3000AreaPane } from './Audit3000AreaPane.js';
import { Audit3000ChecksPanel } from './Audit3000ChecksPanel.js';
import { HedgehogRunner } from './HedgehogRunner.js';
import { initialState } from './hedgehog-runner-engine.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  coerceAuditChecks,
  getAuditChecks,
} from '../../../../lib/programs/audit/types.js';
import { getProgramConfig } from '../../../../lib/programs/program-registry.js';
import { WIZARD_LOG_FILE } from '../../../../utils/paths.js';

const AUDIT_3000_REPORT_FILE_FALLBACK = 'posthog-audit-3000-report.md';

interface Audit3000RunScreenProps {
  store: WizardStore;
}

export const Audit3000RunScreen = ({ store }: Audit3000RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // Mirror the agent's audit ledger into the store. The audit-3000 skill
  // writes to the same `.posthog-audit-checks.json` path the original
  // audit uses, so the file watcher key is shared.
  useFileWatcher(join(store.session.installDir, AUDIT_CHECKS_FILE), (parsed) =>
    store.setFrameworkContext(AUDIT_CHECKS_KEY, coerceAuditChecks(parsed)),
  );

  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  const [columns] = useStdoutDimensions();
  // Game state is lifted here so it survives tab switches — the HedgehogRunner
  // unmounts whenever the user views another tab, but the score / position /
  // obstacles stay frozen until they switch back.
  const [gameState, setGameState] = useState(() => initialState());
  const checks = getAuditChecks(store.session);
  const reportFile =
    getProgramConfig(store.router.activeProgram).reportFile ??
    AUDIT_3000_REPORT_FILE_FALLBACK;
  const reportPath = `./${reportFile}`;
  const checksPanel = <Audit3000ChecksPanel checks={checks} />;
  const areaPane = (
    <Audit3000AreaPane checks={checks} reportPath={reportPath} />
  );

  // Narrow terminals: drop the area pane.
  const statusComponent =
    columns < 80 ? (
      <Box flexDirection="column" flexGrow={1}>
        {checksPanel}
      </Box>
    ) : (
      <SplitView left={areaPane} right={checksPanel} />
    );

  const tabs = [
    { id: 'status', label: 'Arcade', component: statusComponent },
    {
      id: 'audit-checks',
      label: 'Hi-score table (report)',
      component: <AuditChecksViewer checks={checks} />,
    },
    {
      id: 'play',
      label: 'Play',
      component: <HedgehogRunner state={gameState} onChange={setGameState} />,
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
