/**
 * Shared "Skill: <id> / URL: <downloadUrl>" block for intro screens.
 *
 * `useSkillEntry` fetches the entry from the skill menu and re-runs when
 * `skillId` or `local` change. The previous fetch is cancelled (its result
 * is ignored) so a session that flips `local=false → true` mid-mount picks
 * up the right base URL.
 *
 * `<SkillSourceInfo>` renders the block, taking the entry as a prop so the
 * caller can reuse the same hook result for additional UI (e.g. showing
 * `skillEntry.name`) without invoking the hook twice.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { fetchSkillMenu, type SkillEntry } from '../../../lib/wizard-tools.js';
import { getSkillsBaseUrl } from '../../../lib/constants.js';

export function useSkillEntry(
  skillId: string | null,
  local: boolean,
): { skillEntry: SkillEntry | null; fetchFailed: boolean } {
  const [skillEntry, setSkillEntry] = useState<SkillEntry | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!skillId) {
      setFetchFailed(true);
      return;
    }
    let cancelled = false;
    setSkillEntry(null);
    setFetchFailed(false);
    void fetchSkillMenu(getSkillsBaseUrl(local)).then((menu) => {
      if (cancelled) return;
      if (!menu) {
        setFetchFailed(true);
        return;
      }
      const match = Object.values(menu.categories)
        .flat()
        .find((s) => s.id === skillId);
      if (match) setSkillEntry(match);
      else setFetchFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [skillId, local]);

  return { skillEntry, fetchFailed };
}

interface SkillSourceInfoProps {
  skillId: string | null;
  skillEntry: SkillEntry | null;
  fetchFailed: boolean;
}

export const SkillSourceInfo = ({
  skillId,
  skillEntry,
  fetchFailed,
}: SkillSourceInfoProps) => (
  <Box flexDirection="column">
    <Text>
      Skill:{' '}
      <Text italic color="cyan">
        {skillId ?? 'unknown'}
      </Text>
    </Text>
    <Text>
      URL:{' '}
      <Text color="cyan">
        {skillEntry?.downloadUrl ??
          (fetchFailed ? 'unavailable' : 'Loading...')}
      </Text>
    </Text>
  </Box>
);
