/**
 * AuditOutroScreen — Audit-specific post-run summary. Renders the standard
 * success / error / cancel views with the audit checks summary inlined into
 * the success body. The report path is hardcoded to AUDIT_REPORT_FILE.
 */

import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { OutroKind } from '../../../../lib/wizard-session.js';
import { Colors } from '../../styles.js';
import { getAuditChecks } from '../../../../lib/workflows/audit/types.js';
import { AuditChecksOutroSection } from './AuditChecksOutroSection.js';

interface AuditOutroScreenProps {
  store: WizardStore;
}

export const AuditOutroScreen = ({ store }: AuditOutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useInput(() => {
    store.setOutroDismissed();
  });

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
