import path from 'path';
import fs from 'fs';
import type { Dirent } from 'fs';
import type { WizardRunOptions } from './types';

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
 * `maxDepth` levels below `rootDir`. All filesystem errors are swallowed:
 * a missing/unreadable root simply yields no callbacks (best-effort).
 *
 * Shared by the detection layers (warehouse sources, etc.) so traversal policy
 * — ignored dirs, depth, symlink handling — lives in one place.
 */
export function walkProjectFiles(
  rootDir: string,
  onFile: (name: string, fullPath: string) => void,
  maxDepth = 3,
): void {
  const visited = new Set<string>();

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    // realpath both resolves symlinked dirs and gives us a stable key to
    // detect loops (symlink cycles, e.g. a -> ../a).
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(realDir)) return;
    visited.add(realDir);

    let entries: Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
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
        } catch {
          continue;
        }
      }

      if (isDir) {
        if (entry.name.startsWith('.')) continue; // skip hidden directories
        scan(fullPath, depth + 1);
      } else if (isFile) {
        onFile(entry.name, fullPath);
      }
    }
  }

  scan(rootDir, 0);
}

/** Read a file as UTF-8, returning `null` on any error. Best-effort. */
export function safeReadFile(fullPath: string): string | null {
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}
