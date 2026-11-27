/** Shared installer for non-framework trait skills (e.g. declared SDK majors) across sequences. */

import * as path from 'path';
import type { LLMProvider } from '@posthog/warlock';
import { downloadSkill } from '@shared/skill-install';
import type { SkillEntry } from '@shared/skill-menu';
import {
  FRAMEWORK_KEY,
  resolveTraitSkills,
  type MatchKeys,
} from '@shared/skill-resolution';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { scanInstalledSkill } from '../../yara-hooks';

const FRAMEWORK_VARIANT_KEY = 'frameworkVariant';

/** Whether `keys` carries any non-framework trait value that could resolve a trait skill. */
export function hasNonFrameworkMatchKeys(keys: MatchKeys): boolean {
  return Object.entries(keys).some(
    ([key, value]) =>
      key !== FRAMEWORK_KEY &&
      key !== FRAMEWORK_VARIANT_KEY &&
      Boolean(value?.length),
  );
}

/** Resolve and download every matching trait skill into `.claude/skills/`, failing open if unavailable. */
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

  for (const skill of resolveTraitSkills(entries, matchKeys)) {
    if (signal?.aborted) return { paths, aborted: true };
    const installed = await downloadSkill(skill, installDir, {
      scan: (dir) => scanInstalledSkill(dir, triageProvider),
    });
    if (signal?.aborted) return { paths, aborted: true };
    analytics.wizardCapture('sdk trait skill resolved', {
      skill_id: skill.id,
      installed: installed.success,
    });
    if (!installed.success) {
      logToFile(
        `[sdk-skills] unavailable ${skill.id}: ${
          installed.error ?? 'unknown error'
        }`,
      );
      continue;
    }
    const skillPath = path.join('.claude', 'skills', skill.id, 'SKILL.md');
    paths.push(skillPath);
    logToFile(`[sdk-skills] installed ${skill.id} at ${skillPath}`);
  }
  return { paths, aborted: false };
}
