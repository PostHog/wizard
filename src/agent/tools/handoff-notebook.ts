/**
 * The PostHog notebook that mirrors a run's handoff report. The first call of a
 * run creates it, later calls (a report task retry) update the same one, so a
 * run owns one notebook. It never throws: a notebook that can't be written is a
 * skip the caller reports, not a failed handoff.
 */

import { createHash } from 'node:crypto';
import axios from 'axios';
import {
  createMarkdownNotebook,
  updateMarkdownNotebook,
  type Credentials,
} from '@shared/api';
import { isGrantRevoked } from '@shared/auth-session-state';
import { oauthCredentials } from '@shared/oauth-session';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

const NOTEBOOK_SCOPE = 'notebook:write';
const DEFAULT_TITLE = 'PostHog setup report';

export type NotebookResult =
  | { outcome: 'created' | 'updated'; url: string }
  | { outcome: 'skipped'; reason: string; description: string };

/** The notebook each program of a run holds: where to update it and the version to send. */
const notebooks = new Map<string, { shortId: string; version: number }>();

/** An alphanumeric id of the 12 characters the backend allows, the same for one key every time. */
const shortIdFor = (key: string): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 12);

/** The backend's title limit, the one the MCP's notebook tools enforce. */
const MAX_TITLE_LENGTH = 256;

/** The report's first H1, which the report is told to open with. */
const titleOf = (markdown: string): string =>
  (/^# +(.+)$/m.exec(markdown)?.[1].trim() || DEFAULT_TITLE).slice(
    0,
    MAX_TITLE_LENGTH,
  );

const skipped = (reason: string, description: string): NotebookResult => {
  logToFile(`[publish_handoff] notebook skipped (${reason})`);
  return { outcome: 'skipped', reason, description };
};

/** A short code for telemetry and a few words for the agent; neither carries a body or a token. */
function skipFor(err: unknown): NotebookResult {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined;
  if (status === 401)
    return skipped('unauthorized', 'PostHog rejected the login');
  if (status === 403) return skipped('http_403', 'PostHog denied access');
  if (status !== undefined) {
    return skipped(`http_${status}`, `PostHog returned HTTP ${status}`);
  }
  return skipped('error', 'the request to PostHog failed');
}

/** Create this program's notebook from `markdown`, or update it when an earlier call in the run made one. */
export async function syncHandoffNotebook(
  markdown: string,
  /** One process can run several programs; each keeps its own notebook. */
  programId = '',
): Promise<NotebookResult> {
  let credentials = await oauthCredentials();
  if (!credentials) return skipped('no_login', 'not logged in to PostHog');
  if (credentials.missingScopes?.includes(NOTEBOOK_SCOPE)) {
    return skipped(
      'missing_scope',
      `the login lacks the ${NOTEBOOK_SCOPE} permission`,
    );
  }

  const key = `${analytics.runId}:${programId}`;
  const held = notebooks.get(key);
  const shortId = held?.shortId ?? shortIdFor(key);
  const write = (login: Credentials): Promise<number> =>
    held
      ? updateMarkdownNotebook(
          login.accessToken,
          login.projectId,
          login.host.apiHost,
          { shortId, markdown, version: held.version },
        )
      : createMarkdownNotebook(
          login.accessToken,
          login.projectId,
          login.host.apiHost,
          { shortId, title: titleOf(markdown), markdown },
        );

  let version: number;
  try {
    try {
      version = await write(credentials);
    } catch (err) {
      if (!axios.isAxiosError(err) || err.response?.status !== 401) throw err;
      if (isGrantRevoked()) throw err;
      const rotated = await oauthCredentials(true);
      if (!rotated || rotated.accessToken === credentials.accessToken)
        throw err;
      credentials = rotated;
      version = await write(rotated);
    }
  } catch (err) {
    return skipFor(err);
  }

  notebooks.set(key, { shortId, version });
  logToFile(`[publish_handoff] notebook ${held ? 'updated' : 'created'}`);
  return {
    outcome: held ? 'updated' : 'created',
    url: `${credentials.host.appHost}/project/${credentials.projectId}/notebooks/${shortId}`,
  };
}
