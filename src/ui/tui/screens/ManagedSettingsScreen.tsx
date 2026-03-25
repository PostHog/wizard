/**
 * ManagedSettingsScreen — Modal when IT/org-managed settings contain overrides
 * that block the Wizard from reaching the PostHog LLM Gateway.
 *
 * Unlike SettingsOverrideScreen, the wizard cannot back up or modify these files.
 * The user must contact their IT administrator to resolve the conflict.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput, ModalOverlay } from '../primitives/index.js';
import { Icons } from '../styles.js';
import type { SettingsConflict } from '../../../lib/agent-interface.js';

function sourceLabel(source: SettingsConflict['source']): string {
  switch (source) {
    case 'managed':
      return 'Managed settings (IT/org-managed)';
    case 'project':
      return '.claude/settings.json';
    default:
      return source;
  }
}

interface ManagedSettingsScreenProps {
  store: WizardStore;
}

export const ManagedSettingsScreen = ({
  store,
}: ManagedSettingsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const conflicts = store.session.settingsConflicts;
  const readOnlyConflicts = conflicts?.filter((c) => !c.writable);

  if (!readOnlyConflicts || readOnlyConflicts.length === 0) {
    return null;
  }

  return (
    <ModalOverlay
      borderColor="red"
      title={`${Icons.warning} Organization settings conflict`}
      width={68}
      footer={
        <ConfirmationInput
          message="Contact your IT administrator to resolve this."
          confirmLabel=""
          cancelLabel="Exit [Esc]"
          onConfirm={() => process.exit(1)}
          onCancel={() => process.exit(1)}
        />
      }
    >
      <Text dimColor>
        Your organization&apos;s managed settings contain overrides that prevent
        the Wizard from reaching the PostHog LLM Gateway.
      </Text>
      {readOnlyConflicts.map((conflict) => (
        <Box key={conflict.source} flexDirection="column" marginTop={1}>
          <Text bold>{sourceLabel(conflict.source)}</Text>
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
      <Box marginTop={1}>
        <Text dimColor>
          Try running "claude auth logout" or contact your IT administrator to
          resolve this.
        </Text>
      </Box>
    </ModalOverlay>
  );
};
