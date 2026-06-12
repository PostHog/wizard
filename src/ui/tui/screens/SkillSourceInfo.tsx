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
import { fetchSkillMenu, type SkillEntry } from '@lib/wizard-tools';
import { CONTEXT_MILL_RELEASE_URL, getSkillsBaseUrl } from '@lib/constants';

/**
 * Resolve a session skillId against the skill-menu entries.
 *
 * `session.skillId` is seeded with the raw integration id during
 * detection (e.g. 'python'), but the menu publishes integration skills
 * under prefixed ids ('integration-python'); frameworks with variants
 * publish several ('integration-nextjs-app-router', '-pages-router').
 * Match chain: exact id → `integration-<id>` → unique
 * `integration-<id>-*` prefix. Ambiguous variants (≥2 prefix matches)
 * return null — the caller should point at the skills repo instead of
 * guessing the wrong variant.
 */
export function resolveSkillEntry(
  entries: SkillEntry[],
  skillId: string,
): SkillEntry | null {
  const exact = entries.find((s) => s.id === skillId);
  if (exact) return exact;

  const prefixed = entries.find((s) => s.id === `integration-${skillId}`);
  if (prefixed) return prefixed;

  const variants = entries.filter((s) =>
    s.id.startsWith(`integration-${skillId}-`),
  );
  return variants.length === 1 ? variants[0] : null;
}

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
      const match = resolveSkillEntry(
        Object.values(menu.categories).flat(),
        skillId,
      );
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
          (fetchFailed ? CONTEXT_MILL_RELEASE_URL : 'Loading...')}
      </Text>
    </Text>
  </Box>
);
