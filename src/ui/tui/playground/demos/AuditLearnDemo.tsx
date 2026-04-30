import { useCallback, useEffect, useState } from 'react';
import { SplitView } from '../../primitives/index.js';
import type { AuditCheck } from '../../../../lib/workflows/audit/types.js';
import { AuditLearnCard } from '../../screens/audit/AuditLearnCard.js';
import { buildShuffledPlaylist } from '../../screens/audit/learnCard/index.js';
import { PendingChecksList } from '../../screens/audit/PendingChecksList.js';

const TIP_DURATION_MS = 15_000;

const MOCK_AUDIT_CHECKS: AuditCheck[] = [
  {
    id: 'sdk-installed',
    area: 'Installation',
    label: 'PostHog SDK installed',
    status: 'pass',
  },
  {
    id: 'sdk-up-to-date',
    area: 'Installation',
    label: 'SDK version up to date',
    status: 'warning',
  },
  {
    id: 'init-correct',
    area: 'Installation',
    label: 'Initialization is correct',
    status: 'pending',
  },
  {
    id: 'identify-stable-distinct-id',
    area: 'Identification',
    label: 'Stable distinct_id',
    status: 'pending',
  },
  {
    id: 'capture-event-names-static',
    area: 'Event Capture',
    label: 'Event names are static strings',
    status: 'pending',
  },
  {
    id: 'capture-growth-events',
    area: 'Event Capture',
    label: 'Signup / activation / purchase tracked',
    status: 'suggestion',
  },
];

export const AuditLearnDemo = () => {
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

  return (
    <SplitView
      left={
        <AuditLearnCard
          tip={playlist[tipIndex]}
          isPlaying={isPlaying}
          onAdvance={takeOver}
          onTogglePlay={togglePlay}
        />
      }
      right={<PendingChecksList checks={MOCK_AUDIT_CHECKS} />}
    />
  );
};
