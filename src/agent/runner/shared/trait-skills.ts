/** Shared installer for non-framework trait skills (e.g. declared SDK majors) across sequences. */

import * as fs from 'fs';
import * as path from 'path';
import type { LLMProvider } from '@posthog/warlock';
import { WIZARD_CACHE_DIR_NAME } from '@shared/constants';
import { downloadSkill } from '@shared/skill-install';
import { fetchSkillMenu, type SkillEntry } from '@shared/skill-menu';
import {
  FRAMEWORK_KEY,
  resolveTraitSkills,
  type MatchKeys,
} from '@shared/skill-resolution';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { scanInstalledSkill } from '../../yara-hooks';

function checkCacheSegment(segmentPath: string, realRoot: string): boolean {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(segmentPath);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return false;
  return fs.realpathSync(segmentPath).startsWith(`${realRoot}${path.sep}`);
}

/** Whether `.posthog-wizard-cache` and its `sdk` subdir are un-symlinked directories inside `installDir`. */
export function isContainedWizardCacheDir(installDir: string): boolean {
  try {
    const installSt = fs.statSync(installDir);
    if (!installSt.isDirectory()) return false;
    const realInstall = fs.realpathSync(installDir);
    const queueDir = path.join(realInstall, WIZARD_CACHE_DIR_NAME);
    if (!checkCacheSegment(queueDir, realInstall)) return false;
    return checkCacheSegment(path.join(queueDir, 'sdk'), realInstall);
  } catch {
    return false;
  }
}

const FRAMEWORK_VARIANT_KEY = 'frameworkVariant';

/** Every skill entry the menu knows, across categories. */
export async function fetchSkillMenuEntries(
  skillsBaseUrl: string,
): Promise<SkillEntry[]> {
  const menu = await fetchSkillMenu(skillsBaseUrl);
  if (!menu) return [];
  return Object.values(menu.categories).flat();
}

/** Whether `keys` carries any non-framework trait value that could resolve a trait skill. */
export function hasNonFrameworkMatchKeys(keys: MatchKeys): boolean {
  return Object.entries(keys).some(
    ([key, value]) =>
      key !== FRAMEWORK_KEY &&
      key !== FRAMEWORK_VARIANT_KEY &&
      Boolean(value?.length),
  );
}

/** Resolve and download every matching trait skill under `.posthog-wizard-cache/sdk/`. */
export async function installTraitSkills({
  entries,
  matchKeys,
  installDir,
  triageProvider,
  signal,
}: {
  entries: readonly SkillEntry[];
  matchKeys: MatchKeys;
  installDir: string;
  triageProvider: LLMProvider | undefined;
  signal?: AbortSignal;
}): Promise<{ paths: string[]; aborted: boolean }> {
  const paths: string[] = [];
  if (signal?.aborted) return { paths, aborted: true };
  if (!isContainedWizardCacheDir(installDir)) {
    logToFile(
      `[sdk-skills] refusing unsafe cache directory under ${installDir}`,
    );
    return { paths, aborted: false };
  }
  const skillsRoot = path.join(WIZARD_CACHE_DIR_NAME, 'sdk');
  for (const skill of resolveTraitSkills(entries, matchKeys)) {
    if (signal?.aborted) return { paths, aborted: true };
    const installed = await downloadSkill(skill, installDir, {
      skillsRoot,
      scan: (dir) => scanInstalledSkill(dir, triageProvider),
    });
    if (signal?.aborted) return { paths, aborted: true };
    const skillPath = path.join(skillsRoot, skill.id, 'SKILL.md');
    if (installed.success) paths.push(skillPath);
    logToFile(
      installed.success
        ? `[sdk-skills] installed ${skill.id} at ${skillPath}`
        : `[sdk-skills] unavailable ${skill.id}: ${
            installed.error ?? 'unknown error'
          }`,
    );
    analytics.wizardCapture('sdk trait skill resolved', {
      skill_id: skill.id,
      installed: installed.success,
    });
  }
  return { paths, aborted: false };
}
