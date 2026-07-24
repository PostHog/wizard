/**
 * Bounded filesystem primitives for scanning USER project trees. Every
 * detection-time glob and project-file read goes through here so the worst
 * case is a constant, never a function of the user's repo.
 */
import * as fs from 'fs';
import fg from 'fast-glob';
import { IGNORED_DIRS } from './file-utils';

// Files larger than this are skipped, never materialized.
export const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024;

// A glob returns at most this many entries.
export const MAX_GLOB_MATCHES = 500;

// A glob's traversal is destroyed after this long, even when abandoned.
export const GLOB_DEADLINE_MS = 8_000;

/**
 * The one shared ignore set for project-tree globs: `IGNORED_DIRS` (which
 * includes `.git`) as fast-glob patterns, plus glob-only additions. Call sites
 * append framework-specific dirs via `extraIgnore` instead of hand-rolling
 * their own list.
 */
export const PROJECT_IGNORE_GLOBS: readonly string[] = [
  ...[...IGNORED_DIRS].map((dir) => `**/${dir}/**`),
  '**/site-packages/**',
  '**/DerivedData/**',
  '**/Pods/**',
];

export interface BoundedGlobOptions {
  cwd: string;
  /** Appended to PROJECT_IGNORE_GLOBS. */
  extraIgnore?: readonly string[];
  /** Stop after this many matches. Defaults to MAX_GLOB_MATCHES. */
  limit?: number;
  /** Match dotfiles. Traversal of dot-DIRECTORIES stays blocked by the ignore set. */
  dot?: boolean;
  /** fast-glob `deep` — maximum directory depth. */
  deep?: number;
}

/**
 * Streams matches, stops at `limit`, destroys the crawl at GLOB_DEADLINE_MS.
 * Returns paths relative to `cwd`, possibly truncated.
 */
export async function boundedGlob(
  patterns: string | string[],
  options: BoundedGlobOptions,
): Promise<string[]> {
  const limit = options.limit ?? MAX_GLOB_MATCHES;
  const stream = fg.stream(patterns, {
    cwd: options.cwd,
    dot: options.dot ?? false,
    onlyFiles: true,
    deep: options.deep,
    ignore: [...PROJECT_IGNORE_GLOBS, ...(options.extraIgnore ?? [])],
    suppressErrors: true,
    followSymbolicLinks: false,
  });

  const matches: string[] = [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(matches);
    };
    const timer = setTimeout(() => {
      stream.destroy();
      finish();
    }, GLOB_DEADLINE_MS);
    stream.on('data', (entry: string | Buffer) => {
      matches.push(String(entry));
      if (matches.length >= limit) {
        stream.destroy();
        finish();
      }
    });
    stream.once('error', finish);
    stream.once('end', finish);
    stream.once('close', finish);
  });
}

/**
 * Read a project file as UTF-8, or null when missing, unreadable, or over
 * `maxBytes` (stat-gated: an oversized file is never materialized).
 */
export function readProjectFile(
  filePath: string,
  maxBytes = MAX_PROJECT_FILE_BYTES,
): string | null {
  try {
    if (fs.statSync(filePath).size > maxBytes) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * The first `bytes` of a file without materializing the rest.
 */
export function readFileHead(filePath: string, bytes: number): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const read = fs.readSync(fd, buffer, 0, bytes, 0);
      return buffer.toString('utf-8', 0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
