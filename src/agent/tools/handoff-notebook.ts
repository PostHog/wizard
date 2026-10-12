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
  fetchMarkdownNotebook,
  updateMarkdownNotebook,
  type Credentials,
} from '@shared/api';
import {
  oauthCredentials,
  rotateAfterUnauthorized,
} from '@shared/oauth-session';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

const NOTEBOOK_SCOPE = 'notebook:write';
const DEFAULT_TITLE = 'PostHog setup report';

export type NotebookResult =
  | { outcome: 'created' | 'updated'; url: string }
  // No notebook was made.
  | { outcome: 'skipped'; reason: string; description: string }
  // The update failed; the notebook still holds the report of the earlier call.
  | {
      outcome: 'not_updated';
      reason: string;
      description: string;
      url: string;
    };

/** One deadline for the whole sync, so a slow PostHog cannot hold the agent's tool call. */
const SYNC_DEADLINE_MS = 8000;

/** The notebook each program of a run holds: where to update it and the version to send. */
const notebooks = new Map<
  string,
  { shortId: string; version: number; url: string }
>();

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

const failed = (
  reason: string,
  description: string,
  heldUrl: string | undefined,
): NotebookResult => {
  logToFile(
    `[publish_handoff] notebook ${
      heldUrl ? 'not updated' : 'skipped'
    } (${reason})`,
  );
  return heldUrl
    ? { outcome: 'not_updated', reason, description, url: heldUrl }
    : { outcome: 'skipped', reason, description };
};

const responseStatus = (err: unknown): number | undefined =>
  axios.isAxiosError(err) ? err.response?.status : undefined;

const TIMEOUT_CODES = new Set(['ERR_CANCELED', 'ECONNABORTED', 'ETIMEDOUT']);

const isTimeout = (err: unknown, signal: AbortSignal): boolean =>
  signal.aborted ||
  (err instanceof Error &&
    TIMEOUT_CODES.has((err as NodeJS.ErrnoException).code ?? ''));

/** A short code for telemetry and a few words for the agent; neither carries a body or a token. */
function failureFor(
  err: unknown,
  signal: AbortSignal,
  heldUrl: string | undefined,
): NotebookResult {
  if (isTimeout(err, signal)) {
    return failed('timeout', 'PostHog did not answer in time', heldUrl);
  }
  const status = responseStatus(err);
  if (status === 401) {
    return failed('unauthorized', 'PostHog rejected the login', heldUrl);
  }
  if (status === 403) {
    return failed('http_403', 'PostHog denied access', heldUrl);
  }
  if (status !== undefined) {
    return failed(`http_${status}`, `PostHog returned HTTP ${status}`, heldUrl);
  }
  return failed('error', 'the request to PostHog failed', heldUrl);
}

/** A write worth one more try: no response at all (not a cancel), or a server error. */
function isTransient(err: unknown, signal: AbortSignal): boolean {
  if (isTimeout(err, signal)) return false;
  const status = responseStatus(err);
  return status === undefined || status >= 500;
}

/** Whether a failed create may still have made the notebook: lost response, server error, or an id clash. */
function mayHaveLanded(err: unknown): boolean {
  const status = responseStatus(err);
  return (
    status === undefined || status >= 500 || status === 400 || status === 409
  );
}

/** Give up on `work` when the deadline passes, even if the call under it ignores the signal. */
function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Create this program's notebook from `markdown`, or update it when an earlier call in the run made one. */
export async function syncHandoffNotebook(
  markdown: string,
  /** One process can run several programs; each keeps its own notebook. */
  programId = '',
): Promise<NotebookResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_DEADLINE_MS);
  try {
    return await sync(markdown, programId, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function sync(
  markdown: string,
  programId: string,
  signal: AbortSignal,
): Promise<NotebookResult> {
  const key = `${analytics.runId}:${programId}`;
  const held = notebooks.get(key);
  const shortId = held?.shortId ?? shortIdFor(key);
  const heldUrl = held?.url;
  let fetched: Credentials | null;
  try {
    fetched = await beforeDeadline(oauthCredentials(), signal);
  } catch (err) {
    return failureFor(err, signal, heldUrl);
  }
  const urlFor = (login: Credentials): string =>
    `${login.host.appHost}/project/${login.projectId}/notebooks/${shortId}`;
  if (!fetched) return failed('no_login', 'not logged in to PostHog', heldUrl);
  let credentials: Credentials = fetched;
  if (credentials.missingScopes?.includes(NOTEBOOK_SCOPE)) {
    return failed(
      'missing_scope',
      `the login lacks the ${NOTEBOOK_SCOPE} permission`,
      heldUrl,
    );
  }

  /** Push `markdown` as this login: create, or update at the version the server holds. */
  const push = async (
    login: Credentials,
    retried: boolean,
  ): Promise<number> => {
    const args = [
      login.accessToken,
      login.projectId,
      login.host.apiHost,
    ] as const;
    let version = held?.version;
    // A failed try may have landed, so ask the server before writing again.
    const lookup = async () => {
      try {
        return await fetchMarkdownNotebook(...args, shortId, signal);
      } catch {
        return null;
      }
    };
    if (retried) {
      const found = await lookup();
      if (found?.markdown === markdown) return found.version;
      version = found?.version ?? version;
    }
    if (version === undefined) {
      try {
        return await createMarkdownNotebook(
          ...args,
          { shortId, title: titleOf(markdown), markdown },
          signal,
        );
      } catch (err) {
        const found = mayHaveLanded(err) ? await lookup() : null;
        if (!found) throw err;
        if (found.markdown === markdown) return found.version;
        version = found.version;
      }
    }
    return updateMarkdownNotebook(
      ...args,
      { shortId, markdown, version },
      signal,
    );
  };

  /** One try, plus one more with a rotated token after a 401. */
  const authorized = async (retried: boolean): Promise<number> => {
    try {
      return await push(credentials, retried);
    } catch (err) {
      if (responseStatus(err) !== 401) throw err;
      const recovery = await beforeDeadline(
        rotateAfterUnauthorized(credentials, { requireRefreshToken: false }),
        signal,
      );
      if (recovery.kind !== 'rotated') throw err;
      credentials = recovery.credentials;
      return push(credentials, retried);
    }
  };

  let version: number;
  try {
    try {
      version = await beforeDeadline(authorized(false), signal);
    } catch (err) {
      if (!isTransient(err, signal)) throw err;
      version = await beforeDeadline(authorized(true), signal);
    }
  } catch (err) {
    return failureFor(err, signal, heldUrl);
  }

  const url = urlFor(credentials);
  notebooks.set(key, { shortId, version, url });
  logToFile(`[publish_handoff] notebook ${held ? 'updated' : 'created'}`);
  return { outcome: held ? 'updated' : 'created', url };
}
