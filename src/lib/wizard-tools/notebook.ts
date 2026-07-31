/**
 * Notebook creation for `publish_handoff` — `POST /api/projects/{id}/notebooks/`.
 *
 * The handoff report is the run's only human-readable output, so this is the
 * call that puts it somewhere the user can open. It replaces the agent doing a
 * `notebooks-create` MCP call and echoing `[NOTEBOOK_URL]` back at us.
 *
 * Retry policy mirrors the task-stream destination, minus its "disable for the
 * rest of the run" behaviour (a tool call has no run-spanning state):
 *   5xx / network → exponential backoff base 500ms cap 8s, max 3 attempts
 *   429           → honour `Retry-After` (seconds), single retry
 *   401 / 403     → give up, no retry (a missing scope won't fix itself)
 *   other 4xx     → give up
 *
 * Never throws: the caller falls back to writing the report to disk, so a
 * failure here has to come back as a value, not an exception.
 */

import type { Credentials } from '@lib/wizard-session';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
/** setTimeout clamps above 2^31-1ms and fires immediately — cap the honoured Retry-After. */
const MAX_RETRY_AFTER_MS = 60_000;

/** The markdown node the PostHog notebook editor renders a report into. */
const MARKDOWN_NODE_ID = 'markdown-notebook-v2';

export interface CreateNotebookResult {
  ok: boolean;
  /** App URL of the created notebook, set when `ok`. */
  url?: string;
  /** Human-readable failure reason, set when `!ok` — surfaced to the agent. */
  error?: string;
}

export interface CreateNotebookOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return BASE_BACKOFF_MS;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/** The tiptap doc a `ph-markdown-notebook` notebook is one markdown node wide. */
export function buildNotebookContent(markdown: string): object {
  return {
    type: 'doc',
    content: [
      {
        type: 'ph-markdown-notebook',
        attrs: { nodeId: MARKDOWN_NODE_ID, markdown },
      },
    ],
  };
}

/**
 * Create a notebook holding `markdown` and return its app URL.
 *
 * `credentials.host.apiHost` is the REST origin; the returned link uses
 * `appHost` so it opens the web app rather than the ingestion domain.
 */
export async function createNotebook(
  credentials: Credentials,
  title: string,
  markdown: string,
  opts: CreateNotebookOptions = {},
): Promise<CreateNotebookResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;

  const url = `${credentials.host.apiHost.replace(/\/$/, '')}/api/projects/${
    credentials.projectId
  }/notebooks/`;
  const init: Parameters<typeof fetch>[1] = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.accessToken}`,
    },
    body: JSON.stringify({ title, content: buildNotebookContent(markdown) }),
  };

  let attempt = 0;
  let backoff = BASE_BACKOFF_MS;
  let retriedAfter429 = false;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `network error: ${message}` };
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      continue;
    }

    if (response.ok) {
      let shortId: unknown;
      try {
        shortId = ((await response.json()) as { short_id?: unknown }).short_id;
      } catch {
        return { ok: false, error: 'the notebook response was not JSON' };
      }
      if (typeof shortId !== 'string' || shortId === '') {
        return {
          ok: false,
          error: 'the notebook response carried no short_id',
        };
      }
      return {
        ok: true,
        url: `${credentials.host.appHost.replace(/\/$/, '')}/project/${
          credentials.projectId
        }/notebooks/${shortId}`,
      };
    }

    const status = response.status;

    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: `auth failed (${status}) — the token may be missing the notebook:write scope`,
      };
    }

    if (status === 429) {
      if (retriedAfter429) return { ok: false, error: 'rate limited' };
      retriedAfter429 = true;
      await sleep(parseRetryAfter(response.headers.get('Retry-After')));
      // Rate limiting isn't a server fault — don't spend the 5xx budget on it.
      attempt -= 1;
      continue;
    }

    if (status >= 500) {
      if (attempt >= MAX_ATTEMPTS) {
        return { ok: false, error: `server error: ${status}` };
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      continue;
    }

    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      /* the status is the whole story */
    }
    return {
      ok: false,
      error: `unexpected status ${status}${detail ? `: ${detail}` : ''}`,
    };
  }

  return { ok: false, error: 'exhausted retries' };
}
