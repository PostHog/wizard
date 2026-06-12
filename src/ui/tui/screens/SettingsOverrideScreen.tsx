import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { ConfirmationInput, ModalOverlay } from '@ui/tui/primitives/index';
import { Icons } from '@ui/tui/styles';

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
  const conflicts = store.session.settingsConflicts?.filter((c) => c.writable);

  if (!conflicts || conflicts.length === 0) {
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
      {conflicts.map((conflict) => (
        <Box key={conflict.path} flexDirection="column" marginBottom={1}>
          <Text>
            Your settings file at <Text bold>{conflict.path}</Text> sets:
          </Text>
          <Box flexDirection="column" paddingLeft={2}>
            {conflict.keys.map((key) => (
              <Text key={key}>
                {Icons.bullet}{' '}
                <Text color="yellow" bold>
                  {key}
                </Text>
              </Text>
            ))}
          </Box>
        </Box>
      ))}
      <Text dimColor>
        These settings override credentials and prevent the Wizard from reaching
        the PostHog LLM Gateway. We can back up the file and continue.
      </Text>
    </ModalOverlay>
  );
};
