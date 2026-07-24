/**
 * Bounded filesystem primitives for scanning USER project trees. Every
 * detection-time glob, walk, and project-file read goes through here so the
 * worst case is a constant, never a function of the user's repo.
 */
import path from 'path';
import fs from 'fs';
import type { Dirent } from 'fs';
import fg from 'fast-glob';
import { analytics } from './analytics';
import { logToFile } from './debug';
import type { WizardRunOptions } from './types';

/**
 * Errno codes that are expected while walking an arbitrary tree and mean
 * "skip this entry", not "something is broken". Scanning from a broad dir
 * (e.g. `~`) routinely hits OS-protected paths (macOS `Library/Group
 * Containers/group.com.apple.*`) that throw EPERM/EACCES per entry — capturing
 * each as an exception buried real errors under thousands of noise events.
 */
const BENIGN_FS_ERROR_CODES = new Set<string>([
  'EACCES', // permission denied
  'EPERM', // operation not permitted (macOS-protected dirs)
  'ENOENT', // entry vanished mid-walk
  'ENOTDIR', // path component isn't a directory
  'ELOOP', // symlink loop
  'ENAMETOOLONG', // path too long
  'EMFILE', // too many open files (environmental, not a wizard bug)
  'ENFILE',
]);

/**
 * Report a swallowed filesystem error. Traversal stays best-effort — the caller
 * still skips the failing entry. Expected errno codes (permission denied, entry
 * vanished, symlink loops…) are logged to the debug file only; anything else is
 * genuinely unexpected and gets captured to error tracking. Preserves the
 * original Error (and its `code`, e.g. EACCES / ENOENT) when available.
 */
function reportFsError(step: string, filePath: string, error: unknown): void {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code && BENIGN_FS_ERROR_CODES.has(code)) {
    logToFile(`[bounded-fs] skipped ${step} (${code}): ${filePath}`);
    return;
  }
  analytics.captureException(
    error instanceof Error ? error : new Error(String(error)),
    { step, path: filePath },
  );
}

export function getDotGitignore({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>) {
  const gitignorePath = path.join(installDir, '.gitignore');
  const gitignoreExists = fs.existsSync(gitignorePath);

  if (gitignoreExists) {
    return gitignorePath;
  }

  return undefined;
}

/**
 * Directory names to skip when scanning a project tree — dependency
 * directories, build output, virtual environments, vendored trees.
 * Used verbatim by walkProjectFiles and as glob patterns by boundedGlob.
 */
export const IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.coverage',
  'venv',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  'target',
  '.gradle',
  '.idea',
  '.vscode',
  'site-packages',
  'DerivedData',
  'Pods',
]);

/** IGNORED_DIRS as fast-glob ignore patterns. */
export const PROJECT_IGNORE_GLOBS: readonly string[] = [...IGNORED_DIRS].map(
  (dir) => `**/${dir}/**`,
);

// Files larger than this are skipped, never materialized.
export const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024;

// A glob returns at most this many entries.
export const MAX_GLOB_MATCHES = 500;

// A glob's traversal is destroyed after this long, even when abandoned.
export const GLOB_DEADLINE_MS = 8_000;

// A directory contributes at most this many entries to a walk.
export const MAX_DIR_ENTRIES = 10_000;

// A walk fires at most this many onFile callbacks.
export const MAX_WALK_FILES = 100_000;

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
 * Walk a project tree, invoking `onFile(name, fullPath)` for every regular
 * file — including dotfiles like `.env` (the caller decides what it cares
 * about). Skips `IGNORED_DIRS` and hidden directories, follows symlinked
 * directories with realpath-based loop protection, descends at most
 * `maxDepth` levels below `rootDir`, and stops at the per-directory and
 * whole-walk caps. Filesystem errors are reported and skipped (best-effort).
 */
export function walkProjectFiles(
  rootDir: string,
  onFile: (name: string, fullPath: string) => void,
  maxDepth = 3,
): void {
  const visited = new Set<string>();
  let filesSeen = 0;
  // Explicit stack — no call-stack recursion.
  const stack: Array<{ dir: string; depth: number }> = [
    { dir: rootDir, depth: 0 },
  ];

  while (stack.length > 0 && filesSeen < MAX_WALK_FILES) {
    const { dir, depth } = stack.pop()!;

    // realpath both resolves symlinked dirs and gives us a stable key to
    // detect loops (symlink cycles, e.g. a -> ../a).
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch (error) {
      reportFsError('walkProjectFiles.realpath', dir, error);
      continue;
    }
    if (visited.has(realDir)) continue;
    visited.add(realDir);

    let handle: fs.Dir;
    try {
      handle = fs.opendirSync(dir);
    } catch (error) {
      reportFsError('walkProjectFiles.opendir', dir, error);
      continue;
    }
    try {
      let entriesRead = 0;
      let entry: Dirent | null;
      while ((entry = handle.readSync()) !== null) {
        if (++entriesRead > MAX_DIR_ENTRIES || filesSeen >= MAX_WALK_FILES) {
          logToFile(
            `[bounded-fs] walk capped in ${dir} (entries=${entriesRead}, files=${filesSeen})`,
          );
          break;
        }
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        // Symlinks report isDirectory()/isFile() as false under withFileTypes,
        // so resolve the target before deciding how to handle the entry.
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            const st = fs.statSync(fullPath);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch (error) {
            reportFsError('walkProjectFiles.stat', fullPath, error);
            continue;
          }
        }

        if (isDir) {
          if (entry.name.startsWith('.')) continue; // skip hidden directories
          if (depth < maxDepth) stack.push({ dir: fullPath, depth: depth + 1 });
        } else if (isFile) {
          filesSeen += 1;
          onFile(entry.name, fullPath);
        }
      }
    } finally {
      try {
        handle.closeSync();
      } catch {
        /* already closed */
      }
    }
  }
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
 * `readProjectFile` that also reports unexpected errors to error tracking.
 * For walk callbacks where a failing read is worth a telemetry breadcrumb.
 */
export function safeReadFile(fullPath: string): string | null {
  try {
    if (fs.statSync(fullPath).size > MAX_PROJECT_FILE_BYTES) {
      logToFile(`[bounded-fs] skipped oversized file: ${fullPath}`);
      return null;
    }
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    reportFsError('safeReadFile', fullPath, error);
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
