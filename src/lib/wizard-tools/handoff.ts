/**
 * publish_handoff — the agent publishes the run's handoff doc (the report
 * markdown) in one explicit call, replacing the report file + watcher path.
 *
 * The call does three things, in descending order of how much we care:
 *   1. stores the text on the session, so the task stream carries it;
 *   2. creates a PostHog notebook holding it, so a human can open it;
 *   3. only if the notebook could not be created, writes the report to disk, so
 *      a run never ends with the report existing nowhere.
 *
 * Step 3 is a fallback, not the happy path — the point of the notebook is that
 * people stop finding a stray markdown file dropped in their repo.
 */

import fs from 'fs';
import path from 'path';

import { getUI } from '@ui';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { Credentials } from '@lib/wizard-session';
import { createNotebook, type CreateNotebookOptions } from './notebook';

// Cap matching the backend serializer (MAX_HANDOFF_TEXT_LENGTH); an oversized push would 400.
export const MAX_HANDOFF_TEXT_CHARS = 64 * 1024;

export const PUBLISH_HANDOFF_TOOL_NAME = 'publish_handoff';

/** Shared between the MCP server and the pi facade so the contract can't drift. */
export const PUBLISH_HANDOFF_DESCRIPTION =
  'Publish the handoff document — the full markdown report of what this run did — to the wizard session. ' +
  'Call it exactly once, at the end of the run, passing the complete report as `content`. ' +
  'It also creates the PostHog notebook the user opens to read the report, so this single call is how the ' +
  'report reaches them: do not write the report to a file, and do not create a notebook yourself.';

export const PUBLISH_HANDOFF_CONTENT_DESCRIPTION =
  'The complete handoff report as markdown, starting with an H1 heading.';

export interface PublishHandoffResult {
  ok: boolean;
  message: string;
}

/**
 * What the tool needs beyond the report itself. Omitted by unit tests and by any
 * host with no credentials yet, in which case the handoff is still stored and
 * only the notebook step is skipped.
 */
export interface PublishHandoffContext {
  /** Resolved at auth time; without it there is no project to create a notebook in. */
  credentials?: Credentials | null;
  /** Project root — where a fallback report file would land. */
  installDir: string;
  /** Fallback filename, e.g. `posthog-setup-report.md`. */
  reportFile: string;
  /** Notebook title, e.g. `PostHog setup (wizard) – my-app`. */
  notebookTitle: string;
  /** Program that published, e.g. `audit` — breaks the analytics down per program. */
  programId?: string;
  /** Test seams for the notebook call. */
  notebookOptions?: CreateNotebookOptions;
}

/**
 * Assemble the tool's context from what every harness already has in scope.
 * Takes primitives rather than a ProgramConfig so `@lib/wizard-tools` stays free
 * of a dependency on the program registry.
 */
export function buildHandoffContext(args: {
  credentials?: Credentials | null;
  installDir: string;
  /** The program's fallback report filename. */
  reportFile?: string;
  /** The program id — names the fallback file, never the notebook title. */
  programId: string;
  /**
   * Human name for the notebook title, e.g. "Set up PostHog SDK integration".
   * The id is a slug, so it must not end up in a title the user reads in their
   * notebook list; fall back to "setup" rather than leaking one.
   */
  programLabel?: string;
}): PublishHandoffContext {
  return {
    credentials: args.credentials,
    installDir: args.installDir,
    reportFile: args.reportFile ?? `posthog-${args.programId}-report.md`,
    notebookTitle: `PostHog ${
      args.programLabel ?? 'setup'
    } (wizard) – ${path.basename(args.installDir)}`,
    programId: args.programId,
  };
}

/** Write the report into the project as a last resort. Returns the path, or null. */
function writeFallbackReport(
  context: PublishHandoffContext,
  text: string,
): string | null {
  try {
    const target = path.join(context.installDir, context.reportFile);
    fs.writeFileSync(target, text, 'utf8');
    return target;
  } catch (err) {
    logToFile(
      `publish_handoff: fallback report write failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // The last copy of the report just failed to land; the caller reports the
    // undelivered handoff, this records why the write itself lost.
    analytics.captureException(
      err instanceof Error ? err : new Error(String(err)),
      {
        source: 'publish_handoff_fallback_write',
        program_id: context.programId,
        report_file: context.reportFile,
      },
    );
    return null;
  }
}

export async function publishHandoff(
  content: string,
  context?: PublishHandoffContext,
): Promise<PublishHandoffResult> {
  // Identifies the run for every event below. Size and truncation describe the
  // report; the report's own text is never sent — it quotes the user's code.
  const base = {
    program_id: context?.programId,
    handoff_chars: content.length,
    handoff_truncated: content.length > MAX_HANDOFF_TEXT_CHARS,
  };

  // One event per call, before any work: the denominator for everything after
  // it, and the only way to see calls that never produced an outcome at all.
  analytics.wizardCapture('handoff called', base);

  if (content.trim() === '') {
    analytics.wizardCapture('handoff rejected', {
      ...base,
      handoff_reject_reason: 'blank_content',
    });
    return {
      ok: false,
      message:
        'Error: `content` must be the complete report markdown (a non-empty string).',
    };
  }
  const truncated = content.length > MAX_HANDOFF_TEXT_CHARS;
  const text = truncated ? content.slice(0, MAX_HANDOFF_TEXT_CHARS) : content;
  const published = `Handoff published (${text.length} chars${
    truncated ? ', truncated to the 64 KB limit' : ''
  }).`;

  // The session copy first: it is what the task stream pushes, and it has to
  // land even if everything below fails.
  getUI().setHandoffText(text);

  if (!context?.credentials) {
    // No project to publish into (unauthenticated host, or a unit test).
    analytics.wizardCapture('handoff published', {
      ...base,
      handoff_outcome: 'session_only',
      handoff_skip_reason: 'no_credentials',
    });
    return { ok: true, message: published };
  }

  const startedAt = Date.now();
  const notebook = await createNotebook(
    context.credentials,
    context.notebookTitle,
    text,
    context.notebookOptions,
  );
  const notebookMs = Date.now() - startedAt;

  if (notebook.ok) {
    getUI().setNotebookUrl(notebook.url);
    analytics.wizardCapture('handoff published', {
      ...base,
      handoff_outcome: 'notebook',
      handoff_notebook_ms: notebookMs,
    });
    return { ok: true, message: `${published} Notebook: ${notebook.url}` };
  }

  // The notebook is the human-readable copy, so losing it means falling back to
  // a file — and telling the outro where that file went.
  const fallbackPath = writeFallbackReport(context, text);
  if (fallbackPath) getUI().setReportFile(context.reportFile);
  logToFile(
    `publish_handoff: notebook creation failed (${notebook.error})${
      fallbackPath ? `, wrote ${fallbackPath}` : ''
    }`,
  );

  analytics.wizardCapture('handoff notebook failed', {
    ...base,
    handoff_notebook_error: notebook.error,
    handoff_notebook_ms: notebookMs,
    handoff_fell_back_to_file: fallbackPath !== null,
  });

  // Losing the notebook is recoverable and expected (a token without
  // notebook:write, say); losing the file too means the report reached nobody,
  // which is the one case worth an exception we go looking for.
  if (!fallbackPath) {
    analytics.captureException(
      new Error(`Handoff undelivered: ${notebook.error}`),
      {
        source: 'publish_handoff_tool',
        report_file: context.reportFile,
        ...base,
      },
    );
  }

  // With a file on disk this is still a success: the handoff is published, the
  // report is readable, and a retry would only duplicate the notebook. With
  // neither, the report reached nobody — say so, so the run doesn't report a
  // handoff it didn't deliver.
  analytics.wizardCapture('handoff published', {
    ...base,
    handoff_outcome: fallbackPath ? 'fallback_file' : 'undelivered',
    handoff_notebook_error: notebook.error,
  });

  return {
    ok: fallbackPath !== null,
    message:
      `${published} The notebook could not be created (${notebook.error})` +
      (fallbackPath
        ? `, so the report was written to \`${context.reportFile}\` instead. Do not retry.`
        : ', and the report could not be written to disk either, so it reached nobody. Do not retry the call.'),
  };
}
