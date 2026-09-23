import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logToFile } from '@utils/debug';
import { registerCleanup } from '@utils/cleanup-registry';

export type RunSkillCleanup = (() => void) & { commit: () => void };
const registeredSkillCleanups = new Set<RunSkillCleanup>();

/** An absent directory is an empty snapshot; a symlink is never a skill root. */
function skillEntries(root: string) {
  try {
    if (!lstatSync(root).isDirectory()) return null;
    return readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Preserve every entry that existed before the run, including older Wizard installs. */
export function captureRunSkillCleanup(installDir: string): RunSkillCleanup {
  const root = join(installDir, '.claude', 'skills');
  const before = skillEntries(root);
  const preexisting = new Set(before?.map((entry) => entry.name));
  let committed = false;

  const cleanup = (() => {
    registeredSkillCleanups.delete(cleanup);
    if (committed || !before) return;
    const current = skillEntries(root);
    if (!current) return;
    for (const entry of current) {
      if (!entry.isDirectory() || preexisting.has(entry.name)) continue;
      const skillDir = join(root, entry.name);
      try {
        if (!lstatSync(join(skillDir, '.posthog-wizard')).isFile()) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      rmSync(skillDir, { recursive: true, force: true });
      logToFile(`[agent-runner] removed failed-run skill ${entry.name}`);
    }
  }) as RunSkillCleanup;
  cleanup.commit = () => {
    committed = true;
    registeredSkillCleanups.delete(cleanup);
  };
  return cleanup;
}

export function registerRunSkillCleanup(installDir: string): RunSkillCleanup {
  const cleanup = captureRunSkillCleanup(installDir);
  registeredSkillCleanups.add(cleanup);
  registerCleanup(cleanup);
  return cleanup;
}

/** Disarm only skill callbacks; other abort cleanup remains registered. */
export function commitRegisteredRunSkillCleanups(): void {
  for (const cleanup of registeredSkillCleanups) cleanup.commit();
}
