/**
 * Read-before-write parity with the anthropic harness. The claude-agent-sdk's
 * Write/Edit tools enforce "read it before you change it" at the tool layer:
 * mutating an EXISTING file requires that the agent has read it since it last
 * changed, creating a brand-new file needs no prior read, and the agent's own
 * successful writes count as knowing the content. pi's built-in write/edit
 * have no such tracking, so the wizard used to compensate with a prompt
 * commandment — which over-enforced (agents `read` missing files before
 * creating them, burning turns on ENOENT) while under-enforcing (nothing
 * actually blocked a stale write). This tracker gives pi the same tool-layer
 * behavior the anthropic arm ships, block messages included verbatim so both
 * arms teach the model the same convention.
 *
 * Correctness parity, not security: filesystem errors fail OPEN (allow) and
 * let the tool itself surface the real error.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileReadTracker {
  /** Record a successful `read` of a path. */
  noteRead(rawPath: string): void;
  /** Record a successful `write`/`edit` — the agent knows the new content. */
  noteMutation(rawPath: string): void;
  /**
   * Gate a `write`/`edit` call. Returns the block reason, or undefined to
   * allow. Brand-new files always pass (an `edit` of a missing file fails in
   * the tool itself with the real ENOENT).
   */
  gate(rawPath: string): string | undefined;
}

export function createFileReadTracker(
  workingDirectory: string,
): FileReadTracker {
  // Absolute path → the mtime the agent last observed, via `read` or its own
  // successful mutation. Mutations by anything else (a linter, an install
  // script, a bash build step) bump the real mtime past the observed one, so
  // the next write/edit is forced back through `read` — the same staleness
  // rule the claude-agent-sdk applies.
  const observed = new Map<string, number>();

  const resolve = (raw: string): string => path.resolve(workingDirectory, raw);

  const record = (raw: string): void => {
    if (!raw) return;
    try {
      observed.set(resolve(raw), fs.statSync(resolve(raw)).mtimeMs);
    } catch {
      // File vanished between tool success and stat — nothing to record.
    }
  };

  return {
    noteRead: record,
    noteMutation: record,
    gate(rawPath: string): string | undefined {
      if (!rawPath) return undefined;
      try {
        const abs = resolve(rawPath);
        if (!fs.existsSync(abs)) return undefined;
        const seen = observed.get(abs);
        if (seen === undefined) {
          return 'File has not been read yet. Read it first before writing to it.';
        }
        if (fs.statSync(abs).mtimeMs > seen) {
          return 'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.';
        }
        return undefined;
      } catch {
        return undefined;
      }
    },
  };
}
