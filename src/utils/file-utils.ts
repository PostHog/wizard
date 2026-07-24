import path from 'path';
import fs from 'fs';
import type { Dirent } from 'fs';
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
function reportFsError(step: string, path: string, error: unknown): void {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code && BENIGN_FS_ERROR_CODES.has(code)) {
    logToFile(`[file-utils] skipped ${step} (${code}): ${path}`);
    return;
  }
  analytics.captureException(
    error instanceof Error ? error : new Error(String(error)),
    { step, path },
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
 * Directory names to skip when recursively scanning a project tree.
 * Used by detection logic (e.g. finding all package.json files) to avoid
 * dependency directories, build output, virtual environments, etc.
 *
 * For fast-glob `ignore` patterns, map this to `**\/<name>/**`.
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
]);

/**
 * Recursively walk a project tree, invoking `onFile(name, fullPath)` for every
 * regular file — including dotfiles like `.env` (the caller decides what it
 * cares about). Skips `IGNORED_DIRS` and hidden directories, follows symlinked
 * directories with realpath-based loop protection, and descends at most
 * `maxDepth` levels below `rootDir`. Filesystem errors are reported to error
 * tracking and then skipped: a missing/unreadable root simply yields no
 * callbacks (best-effort).
 *
 * Shared by the detection layers (warehouse sources, etc.) so traversal policy
 * — ignored dirs, depth, symlink handling — lives in one place.
 */
// A directory contributes at most this many entries to a walk.
export const MAX_DIR_ENTRIES = 10_000;

// A walk fires at most this many onFile callbacks.
export const MAX_WALK_FILES = 100_000;

export function walkProjectFiles(
  rootDir: string,
  onFile: (name: string, fullPath: string) => void,
  maxDepth = 3,
): void {
  const visited = new Set<string>();
  let filesSeen = 0;

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth || filesSeen >= MAX_WALK_FILES) return;

    // realpath both resolves symlinked dirs and gives us a stable key to
    // detect loops (symlink cycles, e.g. a -> ../a).
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch (error) {
      reportFsError('walkProjectFiles.realpath', dir, error);
      return;
    }
    if (visited.has(realDir)) return;
    visited.add(realDir);

    let handle: fs.Dir;
    try {
      handle = fs.opendirSync(dir);
    } catch (error) {
      reportFsError('walkProjectFiles.opendir', dir, error);
      return;
    }
    try {
      let entriesRead = 0;
      let entry: Dirent | null;
      while ((entry = handle.readSync()) !== null) {
        if (++entriesRead > MAX_DIR_ENTRIES || filesSeen >= MAX_WALK_FILES) {
          logToFile(
            `[file-utils] walk capped in ${dir} (entries=${entriesRead}, files=${filesSeen})`,
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
          scan(fullPath, depth + 1);
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

  scan(rootDir, 0);
}

// Files larger than this are skipped, never materialized.
export const MAX_SAFE_READ_BYTES = 2 * 1024 * 1024;

/**
 * Read a file as UTF-8, returning `null` on any error or when it exceeds
 * MAX_SAFE_READ_BYTES. Best-effort: errors are reported to error tracking,
 * then swallowed.
 */
export function safeReadFile(fullPath: string): string | null {
  try {
    if (fs.statSync(fullPath).size > MAX_SAFE_READ_BYTES) {
      logToFile(`[file-utils] skipped oversized file: ${fullPath}`);
      return null;
    }
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    reportFsError('safeReadFile', fullPath, error);
    return null;
  }
}
