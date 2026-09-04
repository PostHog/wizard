import { execSync } from 'child_process';

/** Paths under `installDir` with uncommitted or untracked changes, empty when clean or not a git repo. */
export function listUncommittedPaths(installDir: string): string[] {
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
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\S+\s+/, ''));
}
