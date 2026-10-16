/**
 * Which skill each orchestrator task installs. The exact-match resolver
 * decides; the criteria resolver runs beside it and every disagreement is
 * logged, until its flag lets it decide, with the old pick as the fallback.
 */
import type { SkillEntry } from '@shared/skill-menu';
import {
  frameworkTag,
  legacySkillCriteria,
  resolveSkill,
  type SkillCriteria,
  type TraitTags,
} from '@shared/skill-resolution';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

/** Menu id for a bare skill id + framework via the menu's declared group/framework/default fields; undefined when nothing matches. */
export function resolveSkillVariantId(
  entries: readonly SkillEntry[],
  skillId: string,
  framework: string | undefined,
): string | undefined {
  if (entries.some((e) => e.id === skillId)) return skillId;
  if (!framework) return undefined;
  const family = entries.filter(
    (e) => e.group === skillId && e.framework === framework,
  );
  return (family.find((e) => e.default) ?? family[0])?.id;
}

/** The framework reference skill's family. */
const REFERENCE_SKILL = 'integration';

export interface SkillPicker {
  /** The menu id a task's frontmatter skill id installs, or undefined when none matches. */
  pick(taskType: string, skillId: string): string | undefined;
  /** The framework's reference integration skill. */
  reference(): string | undefined;
}

export function createSkillPicker(opts: {
  entries: readonly SkillEntry[];
  framework: string | undefined;
  traits: TraitTags;
  /** The criteria resolver decides; the exact-match pick is its fallback. */
  useCriteria: boolean;
}): SkillPicker {
  const { entries, framework, useCriteria } = opts;
  const traits: TraitTags = framework
    ? { ...opts.traits, framework: [frameworkTag(framework)] }
    : opts.traits;
  const reported = new Set<string>();

  const decide = (
    taskType: string,
    skillId: string,
    criteria: SkillCriteria,
  ): string | undefined => {
    const legacy = resolveSkillVariantId(entries, skillId, framework);
    let judged: string | undefined;
    try {
      judged = resolveSkill(entries, criteria, traits)?.id;
    } catch (error) {
      logToFile(`[orchestrator] criteria resolver threw: ${String(error)}`);
      return legacy;
    }
    const key = `${taskType}/${skillId}`;
    if (judged !== legacy && !reported.has(key)) {
      reported.add(key);
      logToFile(
        `[orchestrator] skill resolver disagreement ${key}: legacy=${
          legacy ?? 'none'
        } criteria=${judged ?? 'none'} traits=${JSON.stringify(traits)}`,
      );
      analytics.wizardCapture('orchestrator skill resolver disagreement', {
        task_type: taskType,
        skill: skillId,
        framework,
        legacy_skill: legacy ?? null,
        criteria_skill: judged ?? null,
        deciding: useCriteria ? 'criteria' : 'legacy',
      });
    }
    return useCriteria ? judged ?? legacy : legacy;
  };

  return {
    pick: (taskType, skillId) =>
      decide(taskType, skillId, legacySkillCriteria(entries, skillId)),
    reference: () =>
      framework
        ? decide(
            'reference',
            REFERENCE_SKILL,
            legacySkillCriteria(entries, REFERENCE_SKILL),
          )
        : undefined,
  };
}
