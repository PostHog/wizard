/**
 * AuditOutroScreen — Audit-specific post-run summary. Renders the standard
 * success / error / cancel views with the audit checks summary inlined into
 * the success body. The report path shown in the success headline comes from
 * the program's `successMessage`, so this screen is program-agnostic.
 */

import { join } from 'node:path';
import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { OutroKind } from '@lib/wizard-session';
import { Colors } from '@ui/tui/styles';
import { getAuditChecks } from '@lib/programs/audit/types';
import { AuditChecksOutroSection } from './AuditChecksOutroSection.js';
import { useDismissOnAnyKey } from '@ui/tui/hooks/useDismissOnAnyKey';

interface AuditOutroScreenProps {
  store: WizardStore;
}

export const AuditOutroScreen = ({ store }: AuditOutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useDismissOnAnyKey(() => store.setOutroDismissed());

  const outroData = store.session.outroData;

  if (!outroData) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text dimColor>Finishing up...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          <Text color="green" bold>
            ✔ {outroData.message || 'Audit complete!'}
          </Text>

          {outroData.dashboardUrl && (
            <Box marginTop={1}>
              <Text>
                Dashboard: <Text color="cyan">{outroData.dashboardUrl}</Text>
              </Text>
            </Box>
          )}

          {outroData.notebookUrl && (
            <Box marginTop={1}>
              <Text>
                Notebook: <Text color="cyan">{outroData.notebookUrl}</Text>
              </Text>
            </Box>
          )}

          {outroData.reportFile && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                Report saved to:
              </Text>
              <Text>
                {join(store.session.installDir, outroData.reportFile)}
              </Text>
              <Text dimColor>
                A markdown file in your project folder. Open it in any editor to
                read the full audit.
              </Text>
            </Box>
          )}

          <AuditChecksOutroSection
            checks={getAuditChecks(store.session)}
            installDir={store.session.installDir}
          />

          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Learn more: <Text color="cyan">{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}

      {outroData.kind === OutroKind.Error && (
        <Box flexDirection="column">
          <Text color="red" bold>
            ✘ {outroData.message || 'An error occurred'}
          </Text>
          {outroData.body && (
            <Box marginTop={1}>
              <Text dimColor>{outroData.body}</Text>
            </Box>
          )}
        </Box>
      )}

      {outroData.kind === OutroKind.Cancel && (
        <Text color="yellow">■ {outroData.message || 'Cancelled'}</Text>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to continue</Text>
      </Box>
    </Box>
  );
};
