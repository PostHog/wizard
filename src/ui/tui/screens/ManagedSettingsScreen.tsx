/**
 * ManagedSettingsScreen — Modal for read-only settings conflicts that block
 * the Wizard from reaching the PostHog LLM Gateway: org-managed settings, the
 * user's global `~/.claude` config, and gitignored project-local overrides.
 *
 * Unlike SettingsOverrideScreen, the wizard cannot safely back up or remove
 * these files for the user, so it names the exact file and key and asks the
 * user to fix it and re-run. Managed (root-owned) files need an IT admin; the
 * rest the user can edit themselves.
 */

import { Box, Text } from 'ink';
import { useEffect, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { ConfirmationInput, ModalOverlay } from '@ui/tui/primitives/index';
import { Icons } from '@ui/tui/styles';
import type { SettingsConflict } from '@lib/agent/claude-settings';
import { analytics } from '@utils/analytics';

function sourceLabel(source: SettingsConflict['source']): string {
  switch (source) {
    case 'managed':
      return 'Organization-managed settings';
    case 'user':
      return 'Your global Claude Code settings';
    case 'project-local':
      return 'Project-local settings';
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

  const hasManaged = Boolean(
    readOnlyConflicts?.some((c) => c.source === 'managed'),
  );
  const hasReadOnly = Boolean(
    readOnlyConflicts && readOnlyConflicts.length > 0,
  );
  useEffect(() => {
    // Read-only conflict — nothing to accept, so impression only.
    if (hasReadOnly) {
      analytics.wizardCapture('settings conflict shown', {
        kind: 'managed',
        has_managed: hasManaged,
      });
    }
  }, [hasReadOnly, hasManaged]);

  if (!readOnlyConflicts || readOnlyConflicts.length === 0) {
    return null;
  }

  return (
    <ModalOverlay
      borderColor="red"
      title={`${Icons.warning} Settings conflict`}
      width={72}
      footer={
        <ConfirmationInput
          message="Fix the file(s) above, then re-run the Wizard."
          confirmLabel=""
          cancelLabel="Exit [Esc]"
          onConfirm={() => process.exit(1)}
          onCancel={() => process.exit(1)}
        />
      }
    >
      <Text dimColor>
        These Claude Code settings override credentials and prevent the Wizard
        from reaching the PostHog LLM Gateway.
      </Text>
      {readOnlyConflicts.map((conflict) => (
        <Box key={conflict.path} flexDirection="column" marginTop={1}>
          <Text bold>{sourceLabel(conflict.source)}</Text>
          <Text dimColor>{conflict.path}</Text>
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
          {hasManaged
            ? 'Remove these keys (or run "claude auth logout"). Managed files are root-owned — ask your IT administrator.'
            : 'Remove these keys, or run "claude auth logout", then re-run the Wizard.'}
        </Text>
      </Box>
    </ModalOverlay>
  );
};
