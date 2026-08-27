/**
 * publish_handoff — the agent publishes the run's handoff doc (the report
 * markdown) in one explicit call, replacing the report file + watcher path.
 */

import { getUI } from '@ui';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { runtimeEnv } from '@env';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

// Cap matching the backend serializer (MAX_HANDOFF_TEXT_LENGTH); an oversized push would 400.
export const MAX_HANDOFF_TEXT_CHARS = 64 * 1024;

export const PUBLISH_HANDOFF_TOOL_NAME = 'publish_handoff';

/** Shared between the MCP server and the pi facade so the contract can't drift. */
export const PUBLISH_HANDOFF_DESCRIPTION =
  'Publish the handoff document — the full markdown report of what this run did — to the wizard session. ' +
  'Call it exactly once, at the end of the run, passing the complete report as `content`. ' +
  'This call is the required way to deliver the report to the user; do not write the report to a file yourself.';

export const PUBLISH_HANDOFF_CONTENT_DESCRIPTION =
  'The complete handoff report as markdown, starting with an H1 heading.';

export interface PublishHandoffResult {
  ok: boolean;
  message: string;
}

/** Write outcome: success, or failure with an agent-safe reason + log-only detail. */
type HandoffFileWrite =
  | { ok: true }
  | { ok: false; reason: string; detail: string };

/**
 * Write the handoff report to the host-designated `targetPath`.
 *
 * The destination comes from the host (`POSTHOG_HANDOFF_OUTPUT_PATH`,
 * process-env only — the agent can neither set nor see it) while the bytes come
 * from the agent, so the write is treated as a trust-boundary crossing:
 * - relative paths are refused (a relative destination would silently resolve
 *   against whatever CWD the wizard happens to run in);
 * - a pre-existing non-regular destination (symlink, directory, FIFO, device)
 *   is refused, so a primed symlink can't redirect the write at another file;
 * - content lands in a unique sibling temp file opened with O_NOFOLLOW |
 *   O_EXCL and is then rename()d over the destination — atomic for a polling
 *   reader, and rename replaces the *link* rather than following it;
 * - the final file is chmod'd to 0o600 even when the host pre-created it with
 *   looser permissions (the report quotes the user's code).
 *
 * `reason` is safe to surface to the agent (it names no path); `detail` carries
 * the specifics for the local log only.
 */
function writeHandoffFileAtomically(
  targetPath: string,
  text: string,
): HandoffFileWrite {
  if (!path.isAbsolute(targetPath)) {
    return {
      ok: false,
      reason: 'destination is not an absolute path',
      detail: `relative destination refused: ${targetPath}`,
    };
  }

  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch {
    stat = undefined; // ENOENT — the write creates it below.
  }
  if (stat && !stat.isFile()) {
    return {
      ok: false,
      reason: 'destination is not a regular file',
      detail: `non-regular destination refused: ${targetPath}`,
    };
  }

  const tmpPath = `${targetPath}.tmp-${process.pid}-${randomBytes(6).toString(
    'hex',
  )}`;
  let fd: number | undefined;
  try {
    fd = openSync(
      tmpPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_TRUNC |
        fsConstants.O_NOFOLLOW |
        fsConstants.O_EXCL,
      0o600,
    );
    writeSync(fd, text, null, 'utf8');
    fchmodSync(fd, 0o600);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, targetPath);
    return { ok: true };
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The write already failed; a close error on top is noise.
      }
    }
    try {
      unlinkSync(tmpPath);
    } catch {
      // Nothing was created at tmpPath, or the rename already consumed it.
    }
    const errno =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as NodeJS.ErrnoException).code)
        : undefined;
    return {
      ok: false,
      reason: errno ?? 'write error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function publishHandoff(content: string): PublishHandoffResult {
  if (content.trim() === '') {
    analytics.wizardCapture('handoff published', {
      handoff_ok: false,
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
  getUI().setHandoffText(text);

  const handoffOutputPath = runtimeEnv('POSTHOG_HANDOFF_OUTPUT_PATH');
  let handoffOutputWritten: boolean | undefined;
  let handoffOutputError: string | undefined;

  if (handoffOutputPath) {
    // Fail-open on purpose: a broken host path must never take the
    // user-facing handoff down with it. But the failure is surfaced to the
    // agent and the log instead of vanishing into a telemetry boolean.
    const write = writeHandoffFileAtomically(handoffOutputPath, text);
    handoffOutputWritten = write.ok;
    if (!write.ok) {
      handoffOutputError = write.reason;
      logToFile(
        `[publish_handoff] host output write failed (${write.reason}): ${write.detail}`,
      );
    }
  }

  // Size and truncation only — never the report itself, which quotes the user's code.
  analytics.wizardCapture('handoff published', {
    handoff_ok: true,
    handoff_chars: text.length,
    handoff_truncated: truncated,
    handoff_output_written: handoffOutputWritten,
  });
  const notes: string[] = [];
  if (truncated) notes.push('truncated to the 64 KB limit');
  if (handoffOutputError) {
    notes.push(`host output write failed: ${handoffOutputError}`);
  }
  return {
    ok: true,
    message: `Handoff published (${text.length} chars${
      notes.length > 0 ? `, ${notes.join('; ')}` : ''
    }).`,
  };
}
