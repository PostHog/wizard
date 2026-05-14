/**
 * Audit3000OutroScreen — high-score-style summary after a v3000 audit run.
 *
 * On success: arcade FINAL SCORE banner with pass / miss tallies, the
 * absolute report path, and the standard problematic-items list.
 *
 * Error and cancel branches mirror `AuditOutroScreen` so failure modes
 * stay legible without arcade dressing.
 */

import { join } from 'node:path';
import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { OutroKind } from '../../../../lib/wizard-session.js';
import { Colors } from '../../styles.js';
import {
  getAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from '../../../../lib/workflows/audit/types.js';
import { AuditChecksOutroSection } from '../audit/AuditChecksOutroSection.js';

const NEON_PINK = '#F54E00';
const NEON_GOLD = '#F9BD2B';
const NEON_BLUE = '#1D4AFF';

const PANEL_WIDTH = 48;

const padCenter = (s: string, width: number): string => {
  if (s.length >= width) return s;
  const total = width - s.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
};

function countByStatus(checks: AuditCheck[]): Record<AuditStatus, number> {
  const counts: Record<AuditStatus, number> = {
    pending: 0,
    pass: 0,
    error: 0,
    warning: 0,
    suggestion: 0,
  };
  for (const c of checks) counts[c.status] += 1;
  return counts;
}

const FinalScorePanel = ({ checks }: { checks: AuditCheck[] }) => {
  const counts = countByStatus(checks);
  const resolved = checks.length - counts.pending;
  const issues = counts.error + counts.warning + counts.suggestion;

  const top = '\u250F' + '\u2501'.repeat(PANEL_WIDTH) + '\u2513';
  const bottom = '\u2517' + '\u2501'.repeat(PANEL_WIDTH) + '\u251B';
  const sep = '\u2520' + '\u2500'.repeat(PANEL_WIDTH) + '\u2528';

  const row = (content: string) => (
    <Text>
      <Text bold color={NEON_PINK}>
        {'\u2503'}
      </Text>
      <Text>{content}</Text>
      <Text bold color={NEON_PINK}>
        {'\u2503'}
      </Text>
    </Text>
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={NEON_PINK}>
        {top}
      </Text>
      {row(padCenter('GAME OVER', PANEL_WIDTH))}
      <Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
        <Text color={NEON_GOLD}>
          {padCenter(
            `FINAL SCORE  ${resolved} / ${checks.length}`,
            PANEL_WIDTH,
          )}
        </Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
      </Text>
      <Text color={NEON_PINK}>{sep}</Text>
      <Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
        <Text color="green">
          {padCenter(`PASS  \u25B2  ${counts.pass}`, PANEL_WIDTH)}
        </Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
      </Text>
      <Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
        <Text color={NEON_BLUE}>
          {padCenter(`MISS  \u25BC  ${issues}`, PANEL_WIDTH)}
        </Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
      </Text>
      <Text bold color={NEON_PINK}>
        {bottom}
      </Text>
    </Box>
  );
};

interface Audit3000OutroScreenProps {
  store: WizardStore;
}

export const Audit3000OutroScreen = ({ store }: Audit3000OutroScreenProps) => {
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
        <Text dimColor>Counting your tokens\u2026</Text>
      </Box>
    );
  }

  const checks = getAuditChecks(store.session);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          <FinalScorePanel checks={checks} />

          <Box marginTop={1}>
            <Text bold color="green">
              {'\u2714'} {outroData.message || 'AUDIT-3000 complete!'}
            </Text>
          </Box>

          {outroData.reportFile && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="cyan">
                High-score reel saved to:
              </Text>
              <Text>
                {join(store.session.installDir, outroData.reportFile)}
              </Text>
              <Text dimColor>
                A markdown file in your project folder — open it in any editor
                to read the full audit.
              </Text>
            </Box>
          )}

          <AuditChecksOutroSection
            checks={checks}
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
            {'\u2718'} {outroData.message || 'An error occurred'}
          </Text>
          {outroData.body && (
            <Box marginTop={1}>
              <Text dimColor>{outroData.body}</Text>
            </Box>
          )}
        </Box>
      )}

      {outroData.kind === OutroKind.Cancel && (
        <Text color="yellow">
          {'\u25A0'} {outroData.message || 'Cancelled'}
        </Text>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to continue</Text>
      </Box>
    </Box>
  );
};
