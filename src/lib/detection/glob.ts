/**
 * Detection glob helpers.
 *
 * Framework detection runs recursive `**` globs across the whole project
 * directory before any agent work starts. On large JS/TS repos those globs will
 * happily descend into `node_modules` (often 100K+ entries) and `.git`, buffer
 * the whole tree into memory, and OOM the process — long before the wizard ever
 * gets to install PostHog. Two things keep that from happening:
 *
 * 1. `DETECTION_IGNORE_PATTERNS` — never walk the heavy, non-source trees.
 * 2. `globWithAbort` — actually stop walking when detection times out.
 */
import fg from 'fast-glob';
import type { Options as FastGlobOptions } from 'fast-glob';
import type { Readable } from 'node:stream';

/**
 * Directory trees that are never part of a project's own source and that blow
 * up recursive globs on large repos. Mirrors the ignore discipline the
 * Django/Flask/FastAPI detectors already follow.
 */
export const DETECTION_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/venv/**',
  '**/.venv/**',
  '**/env/**',
  '**/.env/**',
  '**/__pycache__/**',
];

/**
 * Run fast-glob, but stop the underlying filesystem walk when `signal` fires.
 *
 * fast-glob (v3) has no `AbortSignal` support, so a plain `fg()` keeps reading
 * the filesystem and buffering matches into memory even after a caller stops
 * awaiting it (e.g. a `Promise.race` detection timeout). Streaming the walk lets
 * us `destroy()` it on abort so memory doesn't keep climbing in the background.
 *
 * When no `signal` is provided this is a thin pass-through to `fg()`.
 */
export async function globWithAbort(
  patterns: string | string[],
  options: FastGlobOptions & { signal?: AbortSignal },
): Promise<string[]> {
  const { signal, ...fgOptions } = options;

  if (!signal) {
    return fg(patterns, fgOptions);
  }
  if (signal.aborted) {
    return [];
  }

  return new Promise<string[]>((resolve, reject) => {
    const matches: string[] = [];
    // fast-glob types stream() as NodeJS.ReadableStream, but the concrete
    // object is a node Readable — cast so we can destroy() the walk on abort.
    const stream = fg.stream(patterns, fgOptions) as Readable;

    const onAbort = () => {
      cleanup();
      stream.destroy();
      // Detection has already timed out and moved on, so this result is
      // discarded — the point of resolving here is only to stop walking.
      resolve(matches);
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    signal.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (entry) => matches.push(String(entry)));
    stream.once('error', (err) => {
      cleanup();
      reject(err);
    });
    stream.once('end', () => {
      cleanup();
      resolve(matches);
    });
  });
}
