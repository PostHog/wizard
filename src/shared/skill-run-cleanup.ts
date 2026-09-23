import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logToFile } from '@utils/debug';

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
export function captureRunSkillCleanup(installDir: string): () => void {
  const root = join(installDir, '.claude', 'skills');
  const before = skillEntries(root);
  if (!before) return () => undefined;
  const preexisting = new Set(before.map((entry) => entry.name));

  return () => {
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
  };
}
