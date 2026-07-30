/**
 * Handoff-publish core — the shared behavior behind the `publish_handoff`
 * wizard tool. One call writes the run's markdown setup report to disk,
 * mirrors it into a shareable PostHog notebook (direct HTTP, no agent IO),
 * and sets it on the store so the task-stream push carries `handoff_text`
 * to the PostHog app.
 *
 * Consolidating the three agent-IO paths the wizard used to run separately
 * (write-file, `notebooks-create` via MCP, passive file-watching) into a
 * single deterministic tool call. The pure helpers here are exported so the
 * MCP facade (`./mcp`) and the pi facade (`harness/pi/...`) share one
 * implementation — tool behavior cannot drift between harnesses.
 *
 * The notebook wire shape mirrors what the posthog-wizard MCP's
 * `notebooks-create` accepts and what the context-mill notebook step used to
 * instruct the agent to build by hand: a ProseMirror doc with one
 * `ph-markdown-notebook` node whose `markdown` attr holds the report.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import type { Credentials } from '@lib/wizard-session';

// Match the backend serializer cap the task-stream handoff_watcher already
// enforces (MAX_HANDOFF_TEXT_CHARS). An oversized doc would 400 the session
// upsert and, because that payload is a full-state snapshot, take every later
// session update down with it.
export const MAX_HANDOFF_CONTENT_CHARS = 64 * 1024;

/** Reject blank input; cap oversize instead of 400ing the session push. */
export function normalizeHandoffContent(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw.length > MAX_HANDOFF_CONTENT_CHARS
    ? raw.slice(0, MAX_HANDOFF_CONTENT_CHARS)
    : raw;
}

/** Default notebook title when the caller omits one. */
export const DEFAULT_NOTEBOOK_TITLE = 'PostHog setup (wizard)';

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

/** Resolve a report path against the working directory, refusing traversal. */
export function resolveReportPath(
  workingDirectory: string,
  reportFile: string,
): string {
  const resolved = path.resolve(workingDirectory, reportFile);
  if (
    resolved !== workingDirectory &&
    !resolved.startsWith(workingDirectory + path.sep)
  ) {
    throw new Error(
      `Path traversal rejected: "${reportFile}" resolves outside working directory`,
    );
  }
  return resolved;
}

/**
 * Atomically write the report markdown to disk. Uses the same rename dance as
 * the ledger writer so the mtime bump is one step — a passive watcher (kept
 * as a fallback) sees a single atomic swap rather than a half-written file.
 */
export function writeReportFile(reportPath: string, content: string): void {
  const dir = path.dirname(reportPath);
  fs.mkdirSync(dir, { recursive: true });
  // writeJsonAtomic is rename-over-target; reuse the primitive but write raw
  // text so the report stays valid markdown, not JSON-encoded.
  const tmpPath = `${reportPath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, reportPath);
}

export interface NotebookCreateResponse {
  /** The notebook's short id, used to build the share URL. */
  short_id?: string;
  id?: string;
}

export interface PublishHandoffHooks {
  /** Set the captured report on the store → task-stream push carries it. */
  setHandoffText?: (text: string) => void;
  /** Surface the notebook URL so the outro screen can link it. */
  setNotebookUrl?: (url: string) => void;
}

/**
 * Context the `publish_handoff` tool is bound to. Threaded into
 * createWizardToolsServer the same way the orchestrator queue context is —
 * built by the runner (which owns the WizardStore + task-stream push + the
 * program's reportFile), absent in hosts without a store or a report.
 */
export interface HandoffToolsContext {
  /** Absolute path the report file is written to (resolved against cwd). */
  reportPath: string;
  /** Lazy credentials resolver — null before auth, so the notebook step skips. */
  getCredentials: () => Credentials | null;
  /** Store hooks for handoff text + notebook URL. Optional in headless hosts. */
  hooks?: PublishHandoffHooks;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

export interface PublishHandoffOptions {
  /** Absolute report file path (resolved against the working directory). */
  reportPath: string;
  /** Credentials for the notebook HTTP call; null pre-auth → notebook skipped. */
  getCredentials: () => Credentials | null;
  /** Optional store hooks. Absent in hosts without a store (CI, headless). */
  hooks?: PublishHandoffHooks;
  /** Override for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export type PublishHandoffResult =
  | { ok: true; reportPath: string; notebookUrl: string | null }
  | { ok: false; reason: 'blank'; message: string };

/**
 * Publish a handoff in one call: write the report file, mirror it into a
 * PostHog notebook (direct HTTP with the run's credentials), and set the
 * captured text on the store so the task-stream push carries `handoff_text`.
 *
 * Failure handling mirrors the task-stream destination: never throw to the
 * caller. The file write and the store update are the load-bearing parts —
 * the notebook upload is best-effort and a failure there returns `notebookUrl:
 * null` rather than failing the whole call. The agent sees a short status and
 * the notebook URL (or the reason it's absent).
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
      reason: 'blank',
      message:
        'Error: publish_handoff received empty content. Pass the full markdown setup report.',
    };
  }

  // 1. Write the report file — the artifact the user opens after the run.
  writeReportFile(opts.reportPath, normalized);
  logToFile(`publish_handoff: wrote ${opts.reportPath}`);

  // 2. Set the store so the task-stream push carries handoff_text. This is
  //    the deterministic capture the passive HandoffWatcher used to provide;
  //    the tool call is now the capture event (the watcher stays as a
  //    fallback for programs that write the file directly).
  opts.hooks?.setHandoffText?.(normalized);

  // 3. Mirror the report into a PostHog notebook. Best-effort: a pre-auth or
  //    transient failure must not fail the whole publish. Credentials may be
  //    null early in the run; the notebook just isn't created yet.
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
        opts.hooks?.setNotebookUrl?.(notebookUrl);
        logToFile(`publish_handoff: notebook ${notebookUrl}`);
      }
    } catch (err: any) {
      // Don't fail the publish — the report file and the session push are the
      // load-bearing deliverables. Surface the error to the debug log only.
      logToFile(
        `publish_handoff: notebook upload failed: ${err?.message ?? err}`,
      );
      analytics.wizardCapture('handoff notebook upload failed', {
        error: String(err?.message ?? err).slice(0, 500),
      });
    }
  } else {
    logToFile('publish_handoff: no credentials yet, skipping notebook upload');
  }

  return { ok: true, reportPath: opts.reportPath, notebookUrl };
}

/**
 * Create a PostHog notebook carrying the report markdown. Calls the notebooks
 * REST endpoint directly with the run's access token (the `notebook:write`
 * scope is already in WIZARD_PROVISIONING_SCOPES), so there's no MCP round-trip
 * and no JSON-encoding the agent has to get right. Returns the shareable URL,
 * or null if the response carried no `short_id`.
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
    body: JSON.stringify({
      title,
      content: buildNotebookContent(markdown),
    }),
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

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const __test = {
  writeReportFile,
  buildNotebookContent,
};

// ---------------------------------------------------------------------------
// Runner-facing factory
// ---------------------------------------------------------------------------

/**
 * Minimal store surface the handoff context needs. The full `WizardStore`
 * satisfies this; the narrower type keeps the runner factory decoupled from
 * the TUI store's implementation and lets tests stub just these methods.
 */
export interface HandoffStoreSurface {
  /** Mirrors the report into the store so the task-stream push carries it. */
  setHandoffText(text: string): void;
  /** Surfaces the notebook URL so the outro screen can link it. */
  setNotebookUrl(url: string): void;
}

/**
 * Build the handoff-publish context a runner threads into `runAgent`. Resolves
 * the report path against the working directory once (the program's
 * `reportFile` is repo-relative), wires the store hooks, and reads credentials
 * lazily so a pre-auth call to the tool just skips the notebook upload.
 *
 * Returns `null` when the program has no reportFile — the runner then omits
 * the context and the `publish_handoff` tool stays unregistered.
 */
export function buildHandoffContext(args: {
  workingDirectory: string;
  reportFile?: string;
  store: HandoffStoreSurface;
  getCredentials: () => Credentials | null;
  fetchImpl?: typeof fetch;
}): HandoffToolsContext | null {
  if (!args.reportFile) return null;
  const reportPath = resolveReportPath(args.workingDirectory, args.reportFile);
  return {
    reportPath,
    getCredentials: args.getCredentials,
    hooks: {
      setHandoffText: (text) => args.store.setHandoffText(text),
      setNotebookUrl: (url) => args.store.setNotebookUrl(url),
    },
    fetchImpl: args.fetchImpl,
  };
}
