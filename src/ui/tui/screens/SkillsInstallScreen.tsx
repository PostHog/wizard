/**
 * SkillsInstallScreen — Fetch the PostHog skills menu from context-mill
 * GitHub Releases and let users pick which skills to install into
 * .claude/skills/.
 *
 * Phase flow:
 *   Loading    → fetch docs-skill-menu.json
 *   Pick       → GroupedPickerMenu (space to toggle, a = all, enter to confirm)
 *   Installing → per-skill: download ZIP → extract files
 *   Done       → per-skill ✓/✗ summary, press Enter/q to exit
 *   FetchError → shown when the menu can't be fetched
 */

import { Box, Text, useInput } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { GroupedPickerMenu } from '../primitives/GroupedPickerMenu.js';
import { Colors } from '../styles.js';
import {
  fetchSkillsMenu,
  installSkill,
  MENU_URL,
  type SkillEntry,
} from '../../../lib/skills-registry.js';

interface SkillsInstallScreenProps {
  store: WizardStore;
}

interface InstallResult {
  id: string;
  displayName: string;
  success: boolean;
  filesWritten?: number;
  error?: string;
}

enum Phase {
  Loading = 'loading',
  Pick = 'pick',
  Installing = 'installing',
  Done = 'done',
  FetchError = 'fetch-error',
}

export const SkillsInstallScreen = ({ store }: SkillsInstallScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [phase, setPhase] = useState<Phase>(Phase.Loading);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [currentSkill, setCurrentSkill] = useState<string | null>(null);
  const [results, setResults] = useState<InstallResult[]>([]);

  const installDir = store.session.installDir;

  // Fetch menu on mount
  useEffect(() => {
    void (async () => {
      const menu = await fetchSkillsMenu();
      if (!menu) {
        setPhase(Phase.FetchError);
        return;
      }
      setSkills(menu.skills);
      setPhase(Phase.Pick);
    })();
  }, []);

  // Exit on Enter/q when done or errored
  useInput(
    (input, key) => {
      if (key.return || input === 'q') process.exit(0);
    },
    { isActive: phase === Phase.Done || phase === Phase.FetchError },
  );

  const entryMap = new Map<string, SkillEntry>(skills.map((s) => [s.id, s]));

  const handleSelect = async (selectedIds: string[]) => {
    if (selectedIds.length === 0) {
      process.exit(0);
    }

    setPhase(Phase.Installing);

    const installed: InstallResult[] = [];

    for (const id of selectedIds) {
      const entry = entryMap.get(id);
      if (!entry) continue;

      const displayName = entry.name;
      setCurrentSkill(displayName);

      const result = await installSkill(entry, installDir ?? process.cwd());
      installed.push({ id, displayName, ...result });
    }

    setCurrentSkill(null);
    setResults(installed);
    setPhase(Phase.Done);
  };

  // Single "PostHog Docs" group for the picker
  const groups: Record<string, Array<{ value: string; label: string }>> = {
    'PostHog Docs': skills.map((s) => ({
      value: s.id,
      label: s.name,
    })),
  };

  const succeededCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Install PostHog Skills
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Loading && <Text dimColor>Fetching skills menu…</Text>}

        {phase === Phase.FetchError && (
          <Box flexDirection="column" gap={1}>
            <Text color="red">Could not fetch skills menu from:</Text>
            <Text dimColor>{MENU_URL}</Text>
            <Text dimColor>Check your internet connection and try again.</Text>
            <Box marginTop={1}>
              <Text dimColor>Press Enter or q to exit.</Text>
            </Box>
          </Box>
        )}

        {phase === Phase.Pick && (
          <GroupedPickerMenu
            message="Select skills to install"
            groups={groups}
            columns={2}
            initialSelected={[]}
            onSelect={(values) => void handleSelect(values)}
          />
        )}

        {phase === Phase.Installing && currentSkill && (
          <Box flexDirection="column">
            <Text dimColor>Installing skills…</Text>
            <Text dimColor>
              {'  '}→ <Text color={Colors.accent}>{currentSkill}</Text>
            </Text>
          </Box>
        )}

        {phase === Phase.Done && (
          <Box flexDirection="column">
            <Box flexDirection="column" marginBottom={1}>
              {results.map((r) => (
                <Box key={r.id} gap={1}>
                  <Text color={r.success ? 'green' : 'red'}>
                    {r.success ? '✓' : '✗'}
                  </Text>
                  <Text bold={r.success}>{r.displayName}</Text>
                  {r.success && (
                    <Text dimColor>
                      → .claude/skills/{r.id}/ ({r.filesWritten} files)
                    </Text>
                  )}
                  {!r.success && r.error && <Text color="red">{r.error}</Text>}
                </Box>
              ))}
            </Box>

            <Text dimColor>
              {succeededCount > 0 &&
                `${succeededCount} skill${
                  succeededCount !== 1 ? 's' : ''
                } installed`}
              {failedCount > 0 &&
                `${succeededCount > 0 ? ', ' : ''}${failedCount} failed`}
              {succeededCount > 0 &&
                ' — skills are active in your .claude/skills/ directory'}
            </Text>

            <Box marginTop={1}>
              <Text dimColor>Press Enter or q to exit.</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
