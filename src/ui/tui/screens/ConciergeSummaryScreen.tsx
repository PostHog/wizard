/**
 * ConciergeSummaryScreen — Post-run summary card for the concierge workflow.
 *
 * Shows the notebook the agent created, the booking link the operator uses
 * to schedule the follow-up call, and the local LLM-handoff report file.
 * Opens the notebook in the user's default browser on mount.
 *
 * Any keypress advances the flow.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Text, useInput } from 'ink';
import opn from 'opn';
import type { WizardStore } from '../store.js';
import { Colors } from '../styles.js';
import { logToFile } from '../../../utils/debug.js';

const CALENDLY_URL =
  'https://calendly.com/christophe-posthog/concierge-meeting';
const REPORT_FILE = 'posthog-concierge-report.md';

interface ConciergeSummaryScreenProps {
  store: WizardStore;
}

export const ConciergeSummaryScreen = ({
  store,
}: ConciergeSummaryScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);

  // Auto-open the notebook URL on first mount (once notebookUrl is set).
  useEffect(() => {
    if (!session.notebookUrl || openedUrl === session.notebookUrl) return;
    setOpenedUrl(session.notebookUrl);
    try {
      void opn(session.notebookUrl);
      logToFile(`[concierge-summary] opened notebook: ${session.notebookUrl}`);
    } catch (err) {
      logToFile(
        `[concierge-summary] failed to open notebook: ${
          (err as Error).message
        }`,
      );
    }
  }, [session.notebookUrl, openedUrl]);

  useInput(() => {
    store.dismissConciergeSummary();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>At your service.</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>
          I have carried out the duties Mr. Christophe entrusted to me.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>I have prepared a notebook for your perusal:</Text>
        {session.notebookUrl ? (
          <>
            <Text color={Colors.primary}>{session.notebookUrl}</Text>
            <Text dimColor>
              I have taken the liberty of opening it in your browser.
            </Text>
          </>
        ) : (
          <Text color={Colors.muted}>
            Regrettably, I was unable to produce a notebook on this occasion —
            please consult the logs at your convenience.
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>
          Should you wish to discuss the matter further with Mr. Christophe, I
          have left his calendar within reach:
        </Text>
        <Text color={Colors.primary}>{CALENDLY_URL}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>
          For any successor I might address later, I have placed a brief dossier
          on the side table:
        </Text>
        <Text color={Colors.muted}>./{REPORT_FILE}</Text>
        <Text dimColor>
          A modest handoff — context and action items, nothing more.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          When you are ready, a single keystroke shall dismiss me.
        </Text>
      </Box>
    </Box>
  );
};
