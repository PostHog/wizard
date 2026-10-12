import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * `host/path` for a git remote, lowercased, with no scheme, user, port or
 * `.git`: `git@github.com:PostHog/wizard.git` → `github.com/posthog/wizard`.
 */
export function normalizeGitRemote(remote: string): string {
  let value = remote.trim().toLowerCase();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(value);
  if (scheme) {
    value = value.slice(scheme[0].length);
  } else {
    // scp-like syntax: user@host:path
    value = value.replace(/^([^/:]+):/, '$1/');
  }
  value = value.replace(/^[^@/]+@/, '');
  value = value.replace(/^([^/:]+):\d+\//, '$1/');
  return value.replace(/\/+$/, '').replace(/\.git$/, '');
}

/** How far up from the install dir to look for the repository root. */
const MAX_PARENT_DIRS = 64;

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The repository an install dir sits in: its origin URL and its root directory. */
export type Repository = { remote: string; root: string };

/**
 * The repository root above `installDir` and the git directory holding its
 * config, found by walking up. A `.git` file (worktree or submodule) points at
 * the real git directory, and a worktree's `commondir` points at the shared one.
 */
function findGitConfigDir(
  installDir: string,
): { root: string; gitDir: string } | null {
  let dir = path.resolve(installDir);
  for (let depth = 0; depth < MAX_PARENT_DIRS; depth += 1) {
    const dotGit = path.join(dir, '.git');
    let gitDir: string | null = null;
    try {
      gitDir = statSync(dotGit).isDirectory() ? dotGit : null;
      if (!gitDir) {
        const pointer = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? '');
        if (pointer) gitDir = path.resolve(dir, pointer[1].trim());
      }
    } catch {
      gitDir = null;
    }
    if (gitDir) {
      const common = readText(path.join(gitDir, 'commondir'))?.trim();
      return {
        root: dir,
        gitDir: common ? path.resolve(gitDir, common) : gitDir,
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * The repository's root and `origin` URL, read from its config file. Read
 * directly rather than through `git`: on Windows, running a bare `git` from
 * the project directory can launch a `git.exe` committed to the repository.
 */
function readRepository(installDir: string): Repository | null {
  const found = findGitConfigDir(installDir);
  if (!found) return null;
  const config = readText(path.join(found.gitDir, 'config'));
  if (!config) return null;
  let inOrigin = false;
  for (const raw of config.split('\n')) {
    const line = raw.trim();
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inOrigin = /^remote\s+"origin"$/.test(section[1].trim());
      continue;
    }
    if (!inOrigin) continue;
    const url = /^url\s*=\s*(.+)$/.exec(line);
    const remote = url?.[1].trim();
    if (remote) return { remote, root: found.root };
  }
  return null;
}

/**
 * Identifies the scanned codebase within a project, so two repos, or two apps
 * in one monorepo, sending scans to one project don't mark each other's tools
 * as removed. Salted with the project ID so the hash can't be matched to a
 * public repo name across projects.
 */
export function workspaceFingerprint(
  projectId: number,
  installDir: string,
  findRepository: (dir: string) => Repository | null = readRepository,
): string {
  const absolute = path.resolve(installDir);
  const repository = findRepository(absolute);
  const workspace = repository
    ? `${normalizeGitRemote(repository.remote)}:${repositoryPath(
        repository.root,
        absolute,
      )}`
    : absolute;
  return createHash('sha256').update(`${projectId}:${workspace}`).digest('hex');
}

/** The install dir's path from the repository root, with POSIX separators; `.` for the root. */
function repositoryPath(root: string, installDir: string): string {
  const relative = path.relative(root, installDir);
  return relative ? relative.split(path.sep).join('/') : '.';
}
