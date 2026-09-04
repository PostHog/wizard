import { execSync } from 'child_process';

/** Paths under `installDir` with uncommitted or untracked changes, empty when clean or not a git repo. */
export function listUncommittedPaths(installDir: string): string[] {
  return listStatusPaths(installDir, () => true);
}

/** Tracked paths under `installDir` that are modified or deleted; untracked files never revert with `git checkout --`. */
export function listModifiedTrackedPaths(installDir: string): string[] {
  return listStatusPaths(installDir, (line) => !line.startsWith('??'));
}

function listStatusPaths(
  installDir: string,
  keep: (line: string) => boolean,
): string[] {
  let status: string;
  try {
    status = execSync('git status --porcelain=v1 -- .', {
      cwd: installDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return [];
  }
  return status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && keep(line))
    .map((line) => line.replace(/^\S+\s+/, ''));
}
