/**
 * SkillsScreen — Ask whether to keep installed skills in .claude/skills/.
 *
 * Shown after the outro summary so users see the agent's output first,
 * then decide whether to keep the skills that powered it.
 *
 * When done, calls store.setSkillsComplete() and exits the process.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors } from '../styles.js';
import { CONTEXT_MILL_URL } from '../../../lib/constants.js';

interface SkillsScreenProps {
  store: WizardStore;
}

interface SkillEntry {
  name: string;
  children: string[];
}

enum Phase {
  Loading = 'loading',
  Ask = 'ask',
  Removing = 'removing',
  Done = 'done',
}

export const SkillsScreen = ({ store }: SkillsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [phase, setPhase] = useState<Phase>(Phase.Loading);
  const [skills, setSkills] = useState<SkillEntry[]>([]);

  const skillsDir = join(store.session.installDir, '.claude', 'skills');

  useEffect(() => {
    void (async () => {
      try {
        const entries = await readdir(skillsDir, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory());
        const result: SkillEntry[] = [];
        for (const dir of dirs) {
          const children = await readdir(join(skillsDir, dir.name));
          result.push({ name: dir.name, children });
        }
        if (result.length === 0) {
          store.setSkillsComplete(true);
          process.exit(0);
        }
        setSkills(result);
        setPhase(Phase.Ask);
      } catch {
        store.setSkillsComplete(true);
        process.exit(0);
      }
    })();
  }, []); // eslint-disable-line

  const handleKeep = () => {
    store.setSkillsComplete(true);
    process.exit(0);
  };

  const handleRemove = async () => {
    setPhase(Phase.Removing);
    try {
      await rm(skillsDir, { recursive: true, force: true });
    } catch {
      // Best-effort removal
    }
    setPhase(Phase.Done);
    store.setSkillsComplete(false);
    process.exit(0);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Keep the skills?
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Loading && (
          <Text dimColor>Checking installed skills...</Text>
        )}

        {phase === Phase.Ask && (
          <>
            <Text dimColor>
              The wizard installed open-source skills that help AI coding agents
              integrate PostHog into your project:
            </Text>
            <Box marginTop={1} flexDirection="column" marginLeft={2}>
              <Text dimColor>.claude/</Text>
              <Text dimColor> skills/</Text>
              {skills.map((skill) => (
                <Box key={skill.name} flexDirection="column">
                  <Text dimColor> {skill.name}/</Text>
                  {skill.children.map((child) => (
                    <Text key={child} dimColor>
                      {'      '}
                      {child}
                    </Text>
                  ))}
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                Source: <Text color="cyan">{CONTEXT_MILL_URL}</Text>
              </Text>
            </Box>
            <Box marginTop={1}>
              <ConfirmationInput
                message="Keep the installed skills?"
                confirmLabel="Keep [Space]"
                cancelLabel="Remove [Esc]"
                onConfirm={handleKeep}
                onCancel={() => void handleRemove()}
              />
            </Box>
          </>
        )}

        {phase === Phase.Removing && <Text dimColor>Removing skills...</Text>}

        {phase === Phase.Done && <Text dimColor>Skills removed.</Text>}
      </Box>
    </Box>
  );
};
