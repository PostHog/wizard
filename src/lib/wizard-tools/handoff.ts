/**
 * Handoff-publish core — the shared behavior behind the `publish_handoff`
 * wizard tool. One call publishes the run's markdown setup report: it is
 * mirrored into a shareable PostHog notebook (direct HTTP, no agent IO) and,
 * when the program opts in via `uploadToPostHog`, set on the store so the
 * task-stream push carries it to the PostHog session as `handoff_text`.
 *
 * No report file is written — the tool replaces the write-file /
 * `notebooks-create`-via-MCP / watch-file-back trio with one deterministic
 * host-side call. One implementation consumed by both protocol facades (the
 * MCP server in `./mcp` and the pi-native tools) so behavior cannot drift
 * between harnesses.
 *
 * The notebook wire shape mirrors what the posthog-wizard MCP's
 * `notebooks-create` accepts and what the context-mill notebook step used to
 * instruct the agent to build by hand: a ProseMirror doc with one
 * `ph-markdown-notebook` node whose `markdown` attr holds the report.
 */

import { getUI } from '@ui';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import type { Credentials } from '@lib/wizard-session';

// Character cap matching the backend serializer (MAX_HANDOFF_TEXT_LENGTH),
// the same cap the task-stream HandoffWatcher enforces: an oversized push
// would 400 and, because the payload is a full-state snapshot, take every
// later session update down with it.
export const MAX_HANDOFF_CONTENT_CHARS = 64 * 1024;

/** Reject blank input; cap oversize instead of 400ing the session push. */
export function normalizeHandoffContent(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw.length > MAX_HANDOFF_CONTENT_CHARS
    ? raw.slice(0, MAX_HANDOFF_CONTENT_CHARS)
    : raw;
}

/** Default notebook title when the caller omits one. */
export const DEFAULT_NOTEBOOK_TITLE = 'PostHog setup (wizard)';

/**
 * Agent-facing usage contract. Lives on the tool itself (both facades) so the
 * shape never has to be duplicated into program prompts — prompts just point
 * at the tool.
 */
export const PUBLISH_HANDOFF_DESCRIPTION =
  "Publish the run's setup report. Call this exactly once at the end of the " +
  'run, passing the FULL report as markdown (start with an H1 heading): what ' +
  'was set up, the files changed, what was verified vs. unconfirmed, and next ' +
  'steps for the user. The tool mirrors the report into a shareable PostHog ' +
  'notebook and publishes it to the wizard session — do NOT write a report ' +
  'file yourself, do NOT call notebooks-create, and do NOT emit a ' +
  '[NOTEBOOK_URL] marker. Returns the notebook URL on success.';

/**
 * Build the ProseMirror doc body the notebooks API expects — one
 * `ph-markdown-notebook` node carrying the report markdown. Same shape the
 * context-mill notebook step hand-rolled; lifted here so the agent never has
 * to JSON-escape a multi-page report again.
 */
export function buildNotebookContent(markdown: string): {
  type: 'doc';
  content: Array<{
    type: 'ph-markdown-notebook';
    attrs: { nodeId: string; markdown: string };
  }>;
} {
  return {
    type: 'doc',
    content: [
      {
        type: 'ph-markdown-notebook',
        attrs: { nodeId: 'markdown-notebook-v2', markdown },
      },
    ],
  };
}

/**
 * Build the shareable notebook URL from the create response's `short_id`.
 * Same shape the context-mill notebook step instructed the agent to emit via
 * `[NOTEBOOK_URL]`: `<appHost>/project/<projectId>/notebooks/<short_id>`.
 */
export function buildNotebookUrl(
  appHost: string,
  projectId: number,
  shortId: string,
): string {
  return `${appHost.replace(
    /\/$/,
    '',
  )}/project/${projectId}/notebooks/${shortId}`;
}

interface NotebookCreateResponse {
  /** The notebook's short id, used to build the share URL. */
  short_id?: string;
}

/**
 * Create a PostHog notebook carrying the report markdown. Calls the notebooks
 * REST endpoint directly with the run's access token (the `notebook:write`
 * scope is already in WIZARD_PROVISIONING_SCOPES), so there is no MCP
 * round-trip and no JSON-encoding the agent has to get right. Returns the
 * shareable URL, or null if the response carried no `short_id`.
 */
export async function uploadNotebook(
  markdown: string,
  title: string,
  creds: Credentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `${creds.host.apiHost.replace(/\/$/, '')}/api/projects/${
    creds.projectId
  }/notebooks/`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: JSON.stringify({ title, content: buildNotebookContent(markdown) }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `notebooks create failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const body = (await response.json()) as NotebookCreateResponse;
  const shortId = body.short_id;
  if (!shortId) return null;
  return buildNotebookUrl(creds.host.appHost, creds.projectId, shortId);
}

export interface PublishHandoffOptions {
  /** Lazy credentials resolver — reads `session.credentials`; null pre-auth. */
  getCredentials: () => Credentials | null;
  /**
   * When true, the report is also set on the store so the task-stream push
   * carries it to the PostHog session as `handoff_text`. Defaults to false —
   * only programs that opted in (self-driving, basic-integration) upload.
   */
  uploadToPostHog?: boolean;
  /** Program id for analytics attribution. */
  program?: string;
  /** Override for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export type PublishHandoffResult =
  | { ok: true; notebookUrl: string | null }
  | { ok: false; message: string };

/**
 * Publish a handoff in one call: mirror the report into a PostHog notebook
 * and, when the program opted in, set it on the store so the task-stream push
 * carries `handoff_text`. Never throws — a notebook failure degrades to
 * `notebookUrl: null` rather than failing the publish, mirroring the
 * fail-silent posture of the task-stream destination.
 */
export async function publishHandoff(
  content: string,
  title: string | undefined,
  opts: PublishHandoffOptions,
): Promise<PublishHandoffResult> {
  const normalized = normalizeHandoffContent(content);
  if (normalized === null) {
    return {
      ok: false,
      message:
        'Error: publish_handoff received empty content. Pass the full markdown setup report.',
    };
  }

  // Session upload — the deterministic capture the passive HandoffWatcher
  // used to provide. Gated per program: only opted-in flows publish the
  // report onto the wizard session row.
  if (opts.uploadToPostHog) {
    getUI().setHandoffText(normalized);
  }

  // Notebook mirror — always attempted, so any skill can hand the user a
  // shareable in-app copy. Best-effort: credentials may be null pre-auth and
  // a transient API failure must not fail the whole publish.
  let notebookUrl: string | null = null;
  const creds = opts.getCredentials();
  if (creds) {
    try {
      notebookUrl = await uploadNotebook(
        normalized,
        title ?? DEFAULT_NOTEBOOK_TITLE,
        creds,
        opts.fetchImpl,
      );
      if (notebookUrl) {
        getUI().setNotebookUrl(notebookUrl);
        logToFile(`publish_handoff: notebook ${notebookUrl}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logToFile(`publish_handoff: notebook upload failed: ${message}`);
      analytics.wizardCapture('handoff publish failed', {
        program: opts.program,
        stage: 'notebook',
        error: message.slice(0, 500),
      });
    }
  } else {
    logToFile('publish_handoff: no credentials yet, skipping notebook upload');
  }

  analytics.wizardCapture('handoff published', {
    program: opts.program,
    content_chars: normalized.length,
    truncated: content.length > normalized.length,
    upload_enabled: opts.uploadToPostHog ?? false,
    notebook_created: notebookUrl !== null,
  });

  return { ok: true, notebookUrl };
}
