/**
 * DownloadSkillScreen — Concierge-only blocking screen between auth and run.
 *
 * On mount, calls `notifications-get` against the PostHog MCP with the
 * OAuth access token, parses the YAML response, extracts the embedded skill
 * + long-form letter from the notification body, writes the skill to
 * `.claude/skills/concierge-<id>/SKILL.md`, and stores the letter on the
 * session so the RunScreen can render it.
 *
 * Marks `session.skillDownloaded = true` when finished; the router then
 * advances to the run step.
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Colors } from '../styles.js';
import { callMcpTool, resolveMcpUrl } from '../../../utils/mcp-client.js';
import { installSkillFromContent } from '../../../lib/wizard-tools.js';
import { logToFile } from '../../../utils/debug.js';

interface DownloadSkillScreenProps {
  store: WizardStore;
}

interface NotificationRecord {
  id: string;
  body: string; // JSON-encoded string of NotificationContent
  [k: string]: unknown;
}

interface NotificationContent {
  body?: string;
  skill?: string;
  long_form_wizard_text?: string;
  notification_style?: string;
}

function parseNotificationBody(
  record: NotificationRecord,
): NotificationContent {
  if (typeof record.body !== 'string') return {};
  try {
    return JSON.parse(record.body) as NotificationContent;
  } catch (err) {
    logToFile(
      `[download-skill] body JSON parse failed: ${(err as Error).message}`,
    );
    return {};
  }
}

export const DownloadSkillScreen = ({ store }: DownloadSkillScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    if (session.skillDownloaded) return;
    if (!session.notificationId || !session.credentials) return;
    setStarted(true);

    void (async () => {
      const mcpUrl = resolveMcpUrl({
        localMcp: session.localMcp,
        region: session.region,
      });
      logToFile(
        `[download-skill] fetching notification ${session.notificationId} via ${mcpUrl}`,
      );
      try {
        const record = await callMcpTool<NotificationRecord>({
          mcpUrl,
          apiKey: session.credentials!.accessToken,
          toolName: 'notifications-get',
          arguments: { id: session.notificationId! },
        });
        const content = parseNotificationBody(record);
        if (content.long_form_wizard_text) {
          store.setNotificationLetter(content.long_form_wizard_text);
        }
        if (!content.skill) {
          throw new Error('Notification body has no `skill` field.');
        }
        const skillId = `concierge-${session.notificationId}`;
        const result = installSkillFromContent(
          skillId,
          content.skill,
          session.installDir,
        );
        if (result.kind !== 'ok') {
          throw new Error(`installSkillFromContent: ${result.kind}`);
        }
        logToFile(`[download-skill] skill written to ${result.path}`);
        store.setSkillDownloaded(result.path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logToFile(`[download-skill] failed: ${message}`);
        store.setSkillDownloadError(message);
      }
    })();
  }, [
    started,
    session.skillDownloaded,
    session.notificationId,
    session.credentials,
  ]);

  // Let users dismiss an error and abort the run by pressing q/esc.
  useInput((input, key) => {
    if (session.skillDownloadError && (input === 'q' || key.escape)) {
      process.exit(1);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Downloading your concierge skill…</Text>
      </Box>
      {session.skillDownloadError ? (
        <Box flexDirection="column">
          <Text color={Colors.error}>Failed to download skill:</Text>
          <Text dimColor>{session.skillDownloadError}</Text>
          <Box marginTop={1}>
            <Text dimColor>Press q or Esc to exit.</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>
            Fetching notification {session.notificationId} and writing the skill
            to .claude/skills/concierge-{session.notificationId}/…
          </Text>
        </Box>
      )}
    </Box>
  );
};
