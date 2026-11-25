/** Shared installer for non-framework trait skills (e.g. declared SDK majors) across sequences. */

import * as path from 'path';
import type { LLMProvider } from '@posthog/warlock';
import { downloadSkill, type InstallSkillResult } from '@shared/skill-install';
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

export type InstallTraitSkillsResult =
  | { kind: 'ok'; paths: string[] }
  | { kind: 'aborted' }
  | { kind: 'failed'; failure: Exclude<InstallSkillResult, { kind: 'ok' }> };

/** Whether `keys` carries any non-framework trait value that could resolve a trait skill. */
export function hasNonFrameworkMatchKeys(keys: MatchKeys): boolean {
  return Object.entries(keys).some(
    ([key, value]) =>
      key !== FRAMEWORK_KEY &&
      key !== FRAMEWORK_VARIANT_KEY &&
      Boolean(value?.length),
  );
}

/** Resolve and download every matching trait skill into `.claude/skills/`. */
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
}): Promise<InstallTraitSkillsResult> {
  const paths: string[] = [];
  if (signal?.aborted) return { kind: 'aborted' };

  for (const skill of resolveTraitSkills(entries, matchKeys)) {
    if (signal?.aborted) return { kind: 'aborted' };
    const installed = await downloadSkill(skill, installDir, {
      scan: (dir) => scanInstalledSkill(dir, triageProvider),
    });
    if (signal?.aborted) return { kind: 'aborted' };
    analytics.wizardCapture('sdk trait skill resolved', {
      skill_id: skill.id,
      installed: installed.success,
    });
    if (!installed.success) {
      const message = installed.error ?? `failed to install ${skill.id}`;
      logToFile(`[sdk-skills] unavailable ${skill.id}: ${message}`);
      return { kind: 'failed', failure: { kind: 'download-failed', message } };
    }
    const skillPath = path.join('.claude', 'skills', skill.id, 'SKILL.md');
    paths.push(skillPath);
    logToFile(`[sdk-skills] installed ${skill.id} at ${skillPath}`);
  }
  return { kind: 'ok', paths };
}
