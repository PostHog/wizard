/** Installs a step skill written once for every framework and completes it from the framework's pack; the sequence README's step skills passage has the rule. */

import path from 'path';
import {
  completeSkillFromPack,
  removeSkillFolder,
} from '@shared/skill-composition';
import type { InstallSkillResult } from '@shared/skill-install';
import type { SkillEntry } from '@shared/skill-menu';

const SKILL_FILE = 'SKILL.md';

/** What one run gives the installer. */
export type RepackagedSkillRun = {
  installDir: string;
  /** Where task skills install, relative to `installDir`. */
  skillsRoot: string;
  /** The framework's reference skill, relative to `installDir`; undefined when the run has none. */
  referencePath: string | undefined;
  /** Installs a menu skill under `skillsRoot`. */
  install: (skillId: string) => Promise<InstallSkillResult>;
  /** Scans one file; a string is the reason the file is refused. */
  scanFile: (file: string) => Promise<string | null>;
  /** Called once for a skill the run cannot complete, before every task that waits on it fails. */
  onUnavailable: (skill: SkillEntry, reason: string) => void;
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Install a skill and complete it from the framework's pack; throws the reason when the run cannot use it. */
async function installCompleted(
  skill: SkillEntry,
  product: string,
  run: RepackagedSkillRun,
): Promise<string> {
  if (!run.referencePath) throw new Error('no framework pack');
  const skillsDir = path.join(run.installDir, run.skillsRoot);
  // A folder an earlier run left behind would pass its old pages off as the skill's own.
  removeSkillFolder(skillsDir, skill.id, run.installDir);
  const result = await run.install(skill.id);
  if (result.kind !== 'ok') throw new Error(result.kind);

  const completed = path.join(run.installDir, result.path);
  try {
    completeSkillFromPack(
      completed,
      path.join(run.installDir, run.referencePath),
      product,
      run.installDir,
    );
    // Completing rewrites SKILL.md, the one file no install scan has read.
    const verdict = await run
      .scanFile(path.join(completed, SKILL_FILE))
      .catch((error: unknown) => `scan failed: ${message(error)}`);
    if (verdict) throw new Error(verdict);
  } catch (error) {
    try {
      // A skill that is not complete and scanned is never left for a task to read.
      removeSkillFolder(skillsDir, skill.id, run.installDir);
    } catch {
      // The task fails either way.
    }
    throw error;
  }
  return result.path;
}

/** The installer for one run: the installed path of a skill whose menu entry has `frameworkReferences`, completed from the framework's pack. It rejects with the reason when the run cannot complete the skill. */
export function repackagedSkillInstaller(
  run: RepackagedSkillRun,
): (skill: SkillEntry & { frameworkReferences: string }) => Promise<string> {
  // A skill installs once a run, so no task reads one that another is still completing.
  const installs = new Map<string, Promise<string>>();
  return (skill) => {
    const started = installs.get(skill.id);
    if (started) return started;
    // Any failure, a thrown one included, is reported once and fails every task that waits on it.
    const install = Promise.resolve()
      .then(() => installCompleted(skill, skill.frameworkReferences, run))
      .catch((error: unknown) => {
        run.onUnavailable(skill, message(error));
        throw error instanceof Error ? error : new Error(message(error));
      });
    installs.set(skill.id, install);
    return install;
  };
}
