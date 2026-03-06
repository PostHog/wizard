/**
 * SettingsOverrideScreen — Modal overlay when .claude/settings.json contains
 * env overrides that block the Wizard from reaching the LLM Gateway.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Icons } from '../styles.js';

interface SettingsOverrideScreenProps {
  store: WizardStore;
}

export const SettingsOverrideScreen = ({
  store,
}: SettingsOverrideScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [feedback, setFeedback] = useState<string | null>(null);
  const keys = store.session.settingsOverrideKeys;

  if (!keys || keys.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        paddingX={3}
        paddingY={1}
        width={64}
      >
        {/* Title */}
        <Box justifyContent="center" marginBottom={1}>
          <Text color="red" bold>
            {Icons.warning} Settings Conflict
          </Text>
        </Box>

        {/* Body */}
        <Text>
          Your project&apos;s <Text bold>.claude/settings.json</Text> sets:
        </Text>
        <Box flexDirection="column" marginY={1} paddingLeft={2}>
          {keys.map((key) => (
            <Text key={key}>
              {Icons.bullet}{' '}
              <Text color="yellow" bold>
                {key}
              </Text>
            </Text>
          ))}
        </Box>
        <Text dimColor>
          These overrides prevent the Wizard from reaching the PostHog LLM
          Gateway. We can back up the file and continue.
        </Text>

        {feedback && (
          <Box marginTop={1}>
            <Text color="yellow">
              {Icons.warning} {feedback}
            </Text>
          </Box>
        )}

        {/* Divider */}
        <Box marginY={1}>
          <Text dimColor>{'─'.repeat(56)}</Text>
        </Box>

        {/* Actions */}
        <ConfirmationInput
          message="Back up to .wizard-backup and continue?"
          confirmLabel="Backup & continue [Enter]"
          cancelLabel="Exit [Esc]"
          onConfirm={() => {
            const ok = store.backupAndFixSettingsOverride();
            if (!ok) {
              setFeedback('Could not back up the settings file.');
            }
          }}
          onCancel={() => process.exit(1)}
        />
      </Box>
    </Box>
  );
};
