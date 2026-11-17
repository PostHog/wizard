/** Installs the skill that stands in for the one a task's prompt names; the sequence README's `wizard-agent-dag-skills` passage has the rule. */

import path from 'path';
import {
  completeSkillFromPack,
  removeSkillFolder,
} from '@shared/skill-composition';
import type { InstallSkillResult } from '@shared/skill-install';
import type { SkillEntry } from '@shared/skill-menu';
import { resolveReplacement } from '@shared/skill-resolution';

const SKILL_FILE = 'SKILL.md';

/** What one run gives the installer. */
export type RepackagedSkillRun = {
  /** The menu's entries; a name's replacement is the entry whose `replaces` is that name. */
  entries: readonly SkillEntry[];
  installDir: string;
  /** Where task skills install, relative to `installDir`. */
  skillsRoot: string;
  /** The framework's reference skill, relative to `installDir`; undefined when the run has none. */
  referencePath: string | undefined;
  /** Installs a menu skill under `skillsRoot`. */
  install: (skillId: string) => Promise<InstallSkillResult>;
  /** Scans one file; a string is the reason the file is refused. */
  scanFile: (file: string) => Promise<string | null>;
  /** Called once for a replacement the run cannot use, before the task reads the skill its prompt names. */
  onUnavailable: (
    replacement: SkillEntry,
    name: string,
    reason: string,
  ) => void;
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Install a replacement and complete it from the framework's pack; throws the reason when the run cannot use it. */
async function installReplacement(
  replacement: SkillEntry,
  run: RepackagedSkillRun,
): Promise<string> {
  const product = replacement.frameworkReferences;
  if (product && !run.referencePath) throw new Error('no framework pack');
  const skillsDir = path.join(run.installDir, run.skillsRoot);
  // A folder an earlier run left behind would pass its old pages off as the skill's own.
  removeSkillFolder(skillsDir, replacement.id, run.installDir);
  const result = await run.install(replacement.id);
  if (result.kind !== 'ok') throw new Error(result.kind);
  if (!product || !run.referencePath) return result.path;

  const completed = path.join(run.installDir, result.path);
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
  if (verdict) {
    try {
      removeSkillFolder(skillsDir, replacement.id, run.installDir);
    } catch {
      // The task reads the skill its prompt names either way.
    }
    throw new Error(verdict);
  }
  return result.path;
}

/** The installer for one run: the installed path of the skill that stands in for a name, or undefined to read the skill the prompt names. */
export function repackagedSkillInstaller(
  run: RepackagedSkillRun,
): (name: string) => Promise<string | undefined> {
  // A replacement installs once a run, so no task reads one that another is still completing.
  const installs = new Map<string, Promise<string | undefined>>();
  return (name) => {
    const replacement = resolveReplacement(run.entries, name);
    if (!replacement) return Promise.resolve(undefined);
    const started = installs.get(replacement.id);
    if (started) return started;
    // Any failure, a thrown one included, sends every task that waits on it to the skill its prompt names.
    const install = installReplacement(replacement, run).catch(
      (error: unknown) => {
        run.onUnavailable(replacement, name, message(error));
        return undefined;
      },
    );
    installs.set(replacement.id, install);
    return install;
  };
}
