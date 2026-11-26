/** Shared installer for non-framework trait skills (e.g. declared SDK majors) across sequences. */

import * as path from 'path';
import type { LLMProvider } from '@posthog/warlock';
import { downloadSkill } from '@shared/skill-install';
import type { SkillEntry } from '@shared/skill-menu';
import {
  DEFAULT_SKILL_TAG,
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

  const matched = resolveTraitSkills(entries, matchKeys);
  const resolvedIds: string[] = [];
  const nonDefaultIds: string[] = [];
  const failedIds: string[] = [];

  for (const skill of matched) {
    if (signal?.aborted) return { paths, aborted: true };
    const installed = await downloadSkill(skill, installDir, {
      scan: (dir) => scanInstalledSkill(dir, triageProvider),
    });
    if (signal?.aborted) return { paths, aborted: true };
    if (!installed.success) {
      failedIds.push(skill.id);
      logToFile(
        `[sdk-skills] unavailable ${skill.id}: ${
          installed.error ?? 'unknown error'
        }`,
      );
      continue;
    }
    resolvedIds.push(skill.id);
    if (!skill.tags?.includes(DEFAULT_SKILL_TAG)) {
      nonDefaultIds.push(skill.id);
    }
    const skillPath = path.join('.claude', 'skills', skill.id, 'SKILL.md');
    paths.push(skillPath);
    logToFile(`[sdk-skills] installed ${skill.id} at ${skillPath}`);
  }

  const declaredSdks = matchKeys.posthogSdks ?? [];
  if (declaredSdks.length > 0 || matched.length > 0) {
    const matchedTags = new Set(matched.flatMap((skill) => skill.tags ?? []));
    const unmatchedSdks = declaredSdks.filter(
      (sdk) => !matchedTags.has(`posthogSdks:${sdk}`),
    );
    if (resolvedIds.length > 0) {
      analytics.setTag('sdk_skills', resolvedIds.join(','));
    }
    analytics.setTag('sdk_non_default_major', nonDefaultIds.length > 0);
    analytics.wizardCapture('sdk skills resolved', {
      resolved_sdk_skill_ids: resolvedIds,
      non_default_sdk_skill_ids: nonDefaultIds,
      failed_sdk_skill_ids: failedIds,
      unmatched_sdks: unmatchedSdks,
    });
  }
  return { paths, aborted: false };
}
