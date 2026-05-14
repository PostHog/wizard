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

/**
 * Turn a raw MCP/Django error into one short readable line. The server
 * returns an HTML traceback on 5xx and verbose multi-line blocks on other
 * failures — neither renders sensibly in the screen's two-line error box.
 */
function summarizeError(raw: string, notificationId: string | null): string {
  const statusMatch = raw.match(/Status Code:\s*(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  const idLabel = notificationId ?? '(unknown id)';
  if (status === 404) {
    return `Notification ${idLabel} not found. Double-check the id and the project you authenticated against.`;
  }
  if (status === 401 || status === 403) {
    return `Authentication failed (${status}). Re-run OAuth — your token may be missing the \`notification:read\` scope.`;
  }
  if (status === 500) {
    return `PostHog returned 500 for id "${idLabel}" (len=${idLabel.length}). Check /tmp/posthog-wizard.log for the exact id the wizard sent — a character may have been dropped between the prompt and the request.`;
  }
  const stripped = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 200 ? stripped.slice(0, 200) + '…' : stripped;
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
        `[download-skill] fetching notification id=${JSON.stringify(
          session.notificationId,
        )} (len=${session.notificationId?.length ?? 0}) via ${mcpUrl}`,
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
        const raw = err instanceof Error ? err.message : String(err);
        logToFile(`[download-skill] failed: ${raw}`);
        store.setSkillDownloadError(
          summarizeError(raw, session.notificationId),
        );
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
