import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
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
import { buildShuffledPlaylist } from './learnCard/index.js';
import { PendingChecksList } from './PendingChecksList.js';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  coerceAuditChecks,
  getAuditChecks,
} from '../../../../lib/workflows/audit/types.js';

const LOG_FILE = '/tmp/posthog-wizard.log';
const TIP_DURATION_MS = 15_000;

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

  const [columns] = useStdoutDimensions();
  const checks = getAuditChecks(store.session);
  const pendingChecksList = <PendingChecksList checks={checks} />;

  // Slideshow state lives on this screen so the auto-advance timer survives
  // tab switches that unmount AuditLearnCard. The playlist is shuffled once
  // at mount; advancing past the end reshuffles into a new pass so every tip
  // is shown before any repeats.
  const [playlist, setPlaylist] = useState(buildShuffledPlaylist);
  const [tipIndex, setTipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  const advance = useCallback(
    (direction: 1 | -1) => {
      setTipIndex((current) => {
        const next = current + direction;
        if (next >= playlist.length) {
          setPlaylist(buildShuffledPlaylist());
          return 0;
        }
        if (next < 0) return playlist.length - 1;
        return next;
      });
    },
    [playlist.length],
  );

  const takeOver = useCallback(
    (direction: 1 | -1) => {
      setIsPlaying(false);
      advance(direction);
    },
    [advance],
  );

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setTimeout(() => advance(1), TIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [advance, isPlaying, tipIndex]);

  const tip = playlist[tipIndex];
  const learnCard = (
    <AuditLearnCard
      tip={tip}
      isPlaying={isPlaying}
      onAdvance={takeOver}
      onTogglePlay={togglePlay}
    />
  );

  // Narrow terminals: drop the slideshow pane.
  const statusComponent =
    columns < 80 ? (
      <Box flexDirection="column" flexGrow={1}>
        {pendingChecksList}
      </Box>
    ) : (
      <SplitView left={learnCard} right={pendingChecksList} />
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
