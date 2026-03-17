/**
 * SettingsOverrideScreen — Modal when .claude/settings.json contains env overrides
 * that block the Wizard from reaching the PostHog LLM Gateway.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput, ModalOverlay } from '../primitives/index.js';
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
    <ModalOverlay
      borderColor="red"
      title={`${Icons.warning} Settings conflict`}
      width={64}
      feedback={feedback ? `${Icons.warning} ${feedback}` : null}
      footer={
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
      }
    >
      <Text>
        Your <Text bold>.claude/settings.json</Text> sets:
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
        These settings override credentials and prevent the Wizard from reaching
        the PostHog LLM Gateway. We can back up the file and continue.
      </Text>
    </ModalOverlay>
  );
};
