/**
 * SkillsScreen — Ask whether to keep installed skills in .claude/skills/.
 *
 * Shown after MCP setup in the wizard flow. Default is "Keep".
 * If the user declines, the skills directory is removed.
 *
 * When done, calls store.setSkillsComplete(). The router resolves to outro.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors } from '../styles.js';

interface SkillsScreenProps {
  store: WizardStore;
}

enum Phase {
  Ask = 'ask',
  Removing = 'removing',
  Done = 'done',
}

export const SkillsScreen = ({ store }: SkillsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [phase, setPhase] = useState<Phase>(Phase.Ask);

  const handleKeep = () => {
    store.setSkillsComplete(true);
  };

  const handleRemove = async () => {
    setPhase(Phase.Removing);
    try {
      const skillsDir = join(store.session.installDir, '.claude', 'skills');
      await rm(skillsDir, { recursive: true, force: true });
    } catch {
      // Best-effort removal
    }
    setPhase(Phase.Done);
    store.setSkillsComplete(false);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Installed Skills
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Ask && (
          <>
            <Text dimColor>
              The wizard installed skills to .claude/skills/ that help AI coding
              agents work with PostHog in your project.
            </Text>
            <Box marginTop={1}>
              <ConfirmationInput
                message="Keep the installed skills?"
                confirmLabel="Keep [Enter]"
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
